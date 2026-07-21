import type { Prisma, PrismaClient, TaskStatus } from "@prisma/client";

import type { ReportResponse } from "./visits.types";

type ReportRow = {
  id: string;
  visitId: string;
  locationId: string;
  representativeUserId: string;
  templateCode: string;
  schemaVersion: string;
  status: string;
  confirmedData: unknown;
  confirmedByUserId: string;
  confirmedAt: Date;
  aiMetadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ReportTaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  isPriority: boolean;
  assignedToUserId: string | null;
  dueDate: Date | null;
};

export async function findReportCreatedTasks(
  prisma: Pick<PrismaClient, "task">,
  tenantId: string,
  reportId: string,
): Promise<ReportTaskRow[]> {
  return prisma.task.findMany({
    where: {
      tenantId,
      reportId,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
}

export function toReportResponse(
  report: ReportRow,
  createdTasks: ReportTaskRow[] = [],
): ReportResponse {
  return {
    id: report.id,
    visitId: report.visitId,
    locationId: report.locationId,
    representativeUserId: report.representativeUserId,
    templateCode: report.templateCode,
    schemaVersion: report.schemaVersion,
    status: report.status,
    confirmedData: report.confirmedData,
    confirmedByUserId: report.confirmedByUserId,
    confirmedAt: report.confirmedAt.toISOString(),
    aiMetadata: report.aiMetadata,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    createdTaskCount: createdTasks.length,
    createdTasks: createdTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      isPriority: task.isPriority,
      assignedToUserId: task.assignedToUserId,
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    })),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ReportDraftTask = {
  title: string;
  description: string | null;
  isPriority: boolean;
  assignee: "representative" | "manager" | "unassigned";
  dueDate: Date | null;
};

// Shared by the AI-draft confirm flow (ai.service.ts) and the manual
// reports/confirm flow (visits.service.ts): both accept a freeform
// `confirmedData.tasksToCreate` array and turn it into real Task rows the
// same way, regardless of which schemaVersion produced the confirmed data.
export function extractTasksToCreate(
  confirmedData: Prisma.InputJsonObject,
): ReportDraftTask[] {
  const tasks = confirmedData.tasksToCreate;

  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.flatMap((task): ReportDraftTask[] => {
    if (
      !isRecord(task) ||
      typeof task.title !== "string" ||
      !task.title.trim()
    ) {
      return [];
    }

    return [
      {
        title: task.title.trim(),
        description:
          typeof task.description === "string" && task.description.trim()
            ? task.description.trim()
            : null,
        isPriority: parseTaskIsPriority(task.isPriority, task.priority),
        assignee: parseTaskAssignee(task.assignee),
        dueDate: parseDateOnly(task.dueDate),
      },
    ];
  });
}

// Transitional: a draft saved by an extraction job that ran before this
// deploy may still carry the old `priority: "high"` field instead of
// `isPriority` — drafts are temporary/short-lived, but one already in flight
// across a deploy shouldn't silently lose its priority flag on confirm.
function parseTaskIsPriority(
  isPriority: unknown,
  legacyPriority: unknown,
): boolean {
  return isPriority === true || legacyPriority === "high";
}

function parseTaskAssignee(
  value: unknown,
): "representative" | "manager" | "unassigned" {
  if (
    value === "representative" ||
    value === "manager" ||
    value === "unassigned"
  ) {
    return value;
  }

  return "unassigned";
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}
