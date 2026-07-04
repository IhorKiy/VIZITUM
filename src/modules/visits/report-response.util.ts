import type { PrismaClient, TaskPriority, TaskStatus } from "@prisma/client";

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
  priority: TaskPriority;
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
      priority: task.priority,
      assignedToUserId: task.assignedToUserId,
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
    })),
  };
}
