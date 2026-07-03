import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  PilotReviewSummaryResponse,
  PilotReviewThreshold,
} from "./pilot-review.types";

const WINDOW_DAYS = 7;
const MIN_COMPLETED_VISITS = 5;
const COMPLETED_VISIT_PLANNED_RATE = 0.8;
const MIN_VALID_IMPORT_ROW_RATE = 0.9;
export const MANAGER_DASHBOARD_VIEWED_EVENT_TYPE = "manager_dashboard.viewed";

@Injectable()
export class PilotReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    context: RequestContext,
  ): Promise<PilotReviewSummaryResponse> {
    const now = new Date();
    const firstVisit = await this.prisma.visit.findFirst({
      where: { tenantId: context.tenantId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });

    if (!firstVisit) {
      return {
        firstVisitAt: null,
        windowStart: null,
        windowEnd: null,
        thresholds: buildNotStartedThresholds(),
        generatedAt: now.toISOString(),
      };
    }

    const windowStart = firstVisit.createdAt;
    const windowEnd = new Date(
      windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const planDateWindow = {
      gte: toUtcDate(windowStart),
      lte: toUtcDate(windowEnd),
    };
    const createdAtWindow = { gte: windowStart, lte: windowEnd };

    const [
      plannedVisitCount,
      visitsInWindow,
      managerTaskCount,
      appliedImportsInWindow,
      managerViewCount,
    ] = await Promise.all([
      this.prisma.routeItem.count({
        where: {
          tenantId: context.tenantId,
          routePlan: { planDate: planDateWindow },
        },
      }),
      this.prisma.visit.findMany({
        where: { tenantId: context.tenantId, createdAt: createdAtWindow },
        select: {
          status: true,
          representativeUserId: true,
          report: { select: { id: true } },
        },
      }),
      this.prisma.task.count({
        where: {
          tenantId: context.tenantId,
          OR: [{ createdAt: createdAtWindow }, { updatedAt: createdAtWindow }],
          createdBy: { roles: { some: { roleCode: "team_manager" } } },
        },
      }),
      this.prisma.importJob.findMany({
        where: {
          tenantId: context.tenantId,
          status: "applied",
          appliedAt: createdAtWindow,
        },
        select: { rowCount: true, validRowCount: true },
      }),
      this.prisma.auditEvent.count({
        where: {
          tenantId: context.tenantId,
          eventType: MANAGER_DASHBOARD_VIEWED_EVENT_TYPE,
          createdAt: createdAtWindow,
        },
      }),
    ]);

    const completedVisits = visitsInWindow.filter(
      (visit) => visit.status === "completed",
    );
    const confirmedReportCount = completedVisits.filter(
      (visit) => visit.report,
    ).length;
    const activeFieldRepCount = new Set(
      visitsInWindow.map((visit) => visit.representativeUserId),
    ).size;
    const bestImportValidRate = appliedImportsInWindow.reduce(
      (best, job) =>
        job.rowCount > 0
          ? Math.max(best, job.validRowCount / job.rowCount)
          : best,
      0,
    );
    const hasSuccessfulImport =
      appliedImportsInWindow.some((job) => job.rowCount > 0) &&
      bestImportValidRate >= MIN_VALID_IMPORT_ROW_RATE;

    const thresholds: PilotReviewThreshold[] = [
      buildCompletedVisitsThreshold(completedVisits.length, plannedVisitCount),
      buildConfirmedReportsThreshold(
        confirmedReportCount,
        completedVisits.length,
      ),
      buildManagerTasksThreshold(managerTaskCount),
      buildImportSuccessThreshold(
        appliedImportsInWindow.length,
        hasSuccessfulImport,
        bestImportValidRate,
      ),
      buildActiveFieldRepThreshold(activeFieldRepCount),
      buildManagerReviewUsageThreshold(managerViewCount),
    ];

    return {
      firstVisitAt: windowStart.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      thresholds,
      generatedAt: now.toISOString(),
    };
  }
}

function buildNotStartedThresholds(): PilotReviewThreshold[] {
  return [
    "completed_visits",
    "confirmed_reports",
    "manager_tasks",
    "import_success",
    "active_field_reps",
    "manager_review_usage",
  ].map((key) => ({
    key,
    label: THRESHOLD_LABELS[key],
    target: THRESHOLD_TARGETS[key],
    result: "Pilot window has not started: no visits recorded yet.",
    status: "na" as const,
  }));
}

const THRESHOLD_LABELS: Record<string, string> = {
  completed_visits: "Completed visits",
  confirmed_reports: "Confirmed reports",
  manager_tasks: "Manager follow-up tasks",
  import_success: "Import application success",
  active_field_reps: "Active Field Representative coverage",
  manager_review_usage: "Manager review usage",
};

const THRESHOLD_TARGETS: Record<string, string> = {
  completed_visits:
    "At least 5 completed visits, or 80% of planned visits, whichever is lower.",
  confirmed_reports: "100% of completed visits have a confirmed report.",
  manager_tasks: "At least one manager follow-up task is created or updated.",
  import_success:
    "At least one import applies with zero partial writes and at least 90% valid rows.",
  active_field_reps: "At least one active Field Representative records work.",
  manager_review_usage:
    "At least one Team Manager opens the dashboard or review output.",
};

function buildCompletedVisitsThreshold(
  completedVisitCount: number,
  plannedVisitCount: number,
): PilotReviewThreshold {
  const target =
    plannedVisitCount > 0
      ? Math.min(
          MIN_COMPLETED_VISITS,
          Math.ceil(plannedVisitCount * COMPLETED_VISIT_PLANNED_RATE),
        )
      : MIN_COMPLETED_VISITS;

  return {
    key: "completed_visits",
    label: THRESHOLD_LABELS.completed_visits,
    target: THRESHOLD_TARGETS.completed_visits,
    result: `${completedVisitCount} completed of ${plannedVisitCount} planned visit(s)`,
    status: completedVisitCount >= target ? "met" : "not_met",
  };
}

function buildConfirmedReportsThreshold(
  confirmedReportCount: number,
  completedVisitCount: number,
): PilotReviewThreshold {
  const status =
    completedVisitCount === 0
      ? "na"
      : confirmedReportCount === completedVisitCount
        ? "met"
        : "not_met";

  return {
    key: "confirmed_reports",
    label: THRESHOLD_LABELS.confirmed_reports,
    target: THRESHOLD_TARGETS.confirmed_reports,
    result:
      completedVisitCount === 0
        ? "No completed visits yet"
        : `${confirmedReportCount}/${completedVisitCount} completed visits have a confirmed report`,
    status,
  };
}

function buildManagerTasksThreshold(
  managerTaskCount: number,
): PilotReviewThreshold {
  return {
    key: "manager_tasks",
    label: THRESHOLD_LABELS.manager_tasks,
    target: THRESHOLD_TARGETS.manager_tasks,
    result: `${managerTaskCount} manager task(s) created or updated`,
    status: managerTaskCount >= 1 ? "met" : "not_met",
  };
}

function buildImportSuccessThreshold(
  appliedImportCount: number,
  hasSuccessfulImport: boolean,
  bestImportValidRate: number,
): PilotReviewThreshold {
  return {
    key: "import_success",
    label: THRESHOLD_LABELS.import_success,
    target: THRESHOLD_TARGETS.import_success,
    result:
      appliedImportCount === 0
        ? "No imports applied yet"
        : `${Math.round(bestImportValidRate * 100)}% valid rows on the best applied import`,
    status:
      appliedImportCount === 0 ? "na" : hasSuccessfulImport ? "met" : "not_met",
  };
}

function buildActiveFieldRepThreshold(
  activeFieldRepCount: number,
): PilotReviewThreshold {
  return {
    key: "active_field_reps",
    label: THRESHOLD_LABELS.active_field_reps,
    target: THRESHOLD_TARGETS.active_field_reps,
    result: `${activeFieldRepCount} active Field Representative(s)`,
    status: activeFieldRepCount >= 1 ? "met" : "not_met",
  };
}

function buildManagerReviewUsageThreshold(
  managerViewCount: number,
): PilotReviewThreshold {
  return {
    key: "manager_review_usage",
    label: THRESHOLD_LABELS.manager_review_usage,
    target: THRESHOLD_TARGETS.manager_review_usage,
    result: `${managerViewCount} dashboard/review view(s) recorded`,
    status: managerViewCount >= 1 ? "met" : "not_met",
  };
}

function toUtcDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}
