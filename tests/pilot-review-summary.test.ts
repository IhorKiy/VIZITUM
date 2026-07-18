import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { PilotReviewController } from "../src/modules/pilot-review/pilot-review.controller";
import { PilotReviewService } from "../src/modules/pilot-review/pilot-review.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const managerContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: ["pilot_review.read"],
};

function thresholdByKey(
  thresholds: Array<{ key: string }>,
  key: string,
): { key: string; status: string; result: string } {
  const threshold = thresholds.find((item) => item.key === key);

  assert.ok(threshold, `expected a threshold with key ${key}`);

  return threshold as never;
}

describe("pilot review summary", () => {
  it("marks every threshold not-started when no visits exist yet", async () => {
    const prisma = {
      visit: {
        findFirst: async () => null,
      },
      routePlan: {
        count: async () => 0,
      },
    };
    const service = new PilotReviewService(prisma as never);

    const summary = await service.getSummary(managerContext as never);

    assert.equal(summary.firstVisitAt, null);
    assert.equal(summary.windowStart, null);
    assert.equal(summary.hasInitialPlan, false);
    assert.equal(summary.thresholds.length, 6);
    assert.ok(
      summary.thresholds.every((threshold) => threshold.status === "na"),
    );
  });

  it("reports an initial plan even before the first visit exists", async () => {
    let capturedRoutePlanWhere: unknown;
    const prisma = {
      visit: {
        findFirst: async () => null,
      },
      routePlan: {
        count: async (query: { where: unknown }) => {
          capturedRoutePlanWhere = query.where;

          return 4;
        },
      },
    };
    const service = new PilotReviewService(prisma as never);

    const summary = await service.getSummary(managerContext as never);

    // Plans are created before any visit, so the check is window-independent
    // and stays true even while every threshold is still not-started.
    assert.equal(summary.hasInitialPlan, true);
    assert.equal(summary.firstVisitAt, null);
    assert.deepEqual(capturedRoutePlanWhere, { tenantId: "tenant-a" });
    assert.ok(
      summary.thresholds.every((threshold) => threshold.status === "na"),
    );
  });

  it("computes thresholds against the 7-day window from the first visit", async () => {
    let capturedVisitFindFirstWhere: unknown;
    let capturedRouteItemWhere: unknown;
    let capturedManagerTaskWhere: unknown;
    const firstVisitCreatedAt = new Date("2026-06-01T00:00:00.000Z");
    const prisma = {
      visit: {
        findFirst: async (query: { where: unknown }) => {
          capturedVisitFindFirstWhere = query.where;

          return { createdAt: firstVisitCreatedAt };
        },
        findMany: async () => [
          {
            status: "completed",
            representativeUserId: "rep-1",
            report: { id: "report-1" },
          },
          {
            status: "completed",
            representativeUserId: "rep-1",
            report: { id: "report-2" },
          },
          {
            status: "completed",
            representativeUserId: "rep-2",
            report: { id: "report-3" },
          },
          {
            status: "completed",
            representativeUserId: "rep-1",
            report: null,
          },
          {
            status: "draft",
            representativeUserId: "rep-2",
            report: null,
          },
        ],
      },
      routePlan: {
        count: async () => 3,
      },
      routeItem: {
        count: async (query: { where: unknown }) => {
          capturedRouteItemWhere = query.where;

          return 6;
        },
      },
      task: {
        count: async (query: { where: unknown }) => {
          capturedManagerTaskWhere = query.where;

          return 2;
        },
      },
      importJob: {
        findMany: async () => [{ rowCount: 100, validRowCount: 95 }],
      },
      auditEvent: {
        count: async () => 1,
      },
    };
    const service = new PilotReviewService(prisma as never);

    const summary = await service.getSummary(managerContext as never);

    assert.equal(summary.firstVisitAt, firstVisitCreatedAt.toISOString());
    assert.equal(summary.windowStart, firstVisitCreatedAt.toISOString());
    assert.equal(summary.hasInitialPlan, true);
    assert.equal(
      summary.windowEnd,
      new Date("2026-06-08T00:00:00.000Z").toISOString(),
    );
    assert.deepEqual(capturedVisitFindFirstWhere, { tenantId: "tenant-a" });
    assert.deepEqual(capturedRouteItemWhere, {
      tenantId: "tenant-a",
      routePlan: {
        tenantId: "tenant-a",
        planDate: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lte: new Date("2026-06-08T00:00:00.000Z"),
        },
      },
    });
    assert.deepEqual(capturedManagerTaskWhere, {
      tenantId: "tenant-a",
      // Soft-deleted tasks must not count as manager engagement.
      deletedAt: null,
      OR: [
        {
          createdAt: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-06-08T00:00:00.000Z"),
          },
        },
        {
          updatedAt: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-06-08T00:00:00.000Z"),
          },
        },
      ],
      createdBy: {
        tenantId: "tenant-a",
        roles: {
          some: {
            tenantId: "tenant-a",
            roleCode: "team_manager",
          },
        },
      },
    });

    const completedVisits = thresholdByKey(
      summary.thresholds,
      "completed_visits",
    );

    assert.equal(completedVisits.status, "not_met");
    assert.equal(completedVisits.result, "4 completed of 6 planned visit(s)");

    const confirmedReports = thresholdByKey(
      summary.thresholds,
      "confirmed_reports",
    );

    assert.equal(confirmedReports.status, "not_met");
    assert.equal(
      confirmedReports.result,
      "3/4 completed visits have a confirmed report",
    );

    const managerTasks = thresholdByKey(summary.thresholds, "manager_tasks");

    assert.equal(managerTasks.status, "met");
    assert.equal(managerTasks.result, "2 manager task(s) created or updated");

    const importSuccess = thresholdByKey(
      summary.thresholds,
      "import_success",
    );

    assert.equal(importSuccess.status, "met");
    assert.equal(
      importSuccess.result,
      "95% valid rows on the best applied import",
    );

    const activeFieldReps = thresholdByKey(
      summary.thresholds,
      "active_field_reps",
    );

    assert.equal(activeFieldReps.status, "met");
    assert.equal(activeFieldReps.result, "2 active Field Representative(s)");

    const managerReviewUsage = thresholdByKey(
      summary.thresholds,
      "manager_review_usage",
    );

    assert.equal(managerReviewUsage.status, "met");
    assert.equal(
      managerReviewUsage.result,
      "1 dashboard/review view(s) recorded",
    );
  });

  it("marks completed visits met once the capped 5-visit target is reached", async () => {
    const prisma = {
      visit: {
        findFirst: async () => ({
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
        }),
        findMany: async () =>
          Array.from({ length: 5 }, (_, index) => ({
            status: "completed",
            representativeUserId: "rep-1",
            report: { id: `report-${index}` },
          })),
      },
      routePlan: { count: async () => 2 },
      routeItem: { count: async () => 50 },
      task: { count: async () => 0 },
      importJob: { findMany: async () => [] },
      auditEvent: { count: async () => 0 },
    };
    const service = new PilotReviewService(prisma as never);

    const summary = await service.getSummary(managerContext as never);
    const completedVisits = thresholdByKey(
      summary.thresholds,
      "completed_visits",
    );

    assert.equal(completedVisits.status, "met");

    const importSuccess = thresholdByKey(
      summary.thresholds,
      "import_success",
    );

    assert.equal(importSuccess.status, "na");
    assert.equal(importSuccess.result, "No imports applied yet");
  });

  it("marks confirmed reports as not applicable before any visit completes", async () => {
    const prisma = {
      visit: {
        findFirst: async () => ({
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
        }),
        findMany: async () => [
          { status: "draft", representativeUserId: "rep-1", report: null },
        ],
      },
      routePlan: { count: async () => 0 },
      routeItem: { count: async () => 0 },
      task: { count: async () => 0 },
      importJob: { findMany: async () => [{ rowCount: 10, validRowCount: 8 }] },
      auditEvent: { count: async () => 0 },
    };
    const service = new PilotReviewService(prisma as never);

    const summary = await service.getSummary(managerContext as never);
    const confirmedReports = thresholdByKey(
      summary.thresholds,
      "confirmed_reports",
    );

    assert.equal(confirmedReports.status, "na");
    assert.equal(confirmedReports.result, "No completed visits yet");

    const importSuccess = thresholdByKey(
      summary.thresholds,
      "import_success",
    );

    assert.equal(importSuccess.status, "not_met");
    assert.equal(
      importSuccess.result,
      "80% valid rows on the best applied import",
    );
  });
});

describe("pilot review controller permissions", () => {
  it("requires pilot_review.read to read the summary", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_METADATA,
        PilotReviewController.prototype.getSummary,
      ),
      [PERMISSIONS.PILOT_REVIEW_READ],
    );
  });

  it("allows dashboard-manager or pilot-review permission to record a view", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_ANY_PERMISSIONS_METADATA,
        PilotReviewController.prototype.recordDashboardView,
      ),
      [PERMISSIONS.DASHBOARD_MANAGER_READ, PERMISSIONS.PILOT_REVIEW_READ],
    );
  });

  it("rejects a dashboard view page outside the allowed set", async () => {
    const auditService = {
      recordEvent: async () => {
        throw new Error("recordEvent must not be called for an invalid page");
      },
    };
    const controller = new PilotReviewController(
      {} as never,
      auditService as never,
    );
    const request = {
      context: {
        requestId: "request-a",
        tenantId: "tenant-a",
        tenantSlug: "tenant-a",
        userId: "manager-a",
        roleCodes: ["team_manager"],
        permissions: ["dashboard.manager.read"],
      },
    };

    await assert.rejects(() =>
      controller.recordDashboardView(request as never, {
        page: "not-a-real-page",
      }),
    );
  });

  it("records a manager dashboard view for an allowed page", async () => {
    let recordedInput: unknown;
    const auditService = {
      recordEvent: async (context: unknown, input: unknown) => {
        recordedInput = input;
      },
    };
    const controller = new PilotReviewController(
      {} as never,
      auditService as never,
    );
    const request = {
      context: {
        requestId: "request-a",
        tenantId: "tenant-a",
        tenantSlug: "tenant-a",
        userId: "manager-a",
        roleCodes: ["team_manager"],
        permissions: ["dashboard.manager.read"],
      },
    };

    await controller.recordDashboardView(request as never, {
      page: "manager",
    });

    assert.deepEqual(recordedInput, {
      entityType: "manager_dashboard",
      entityId: "manager-a",
      eventType: "manager_dashboard.viewed",
      metadata: { page: "manager" },
    });
  });
});
