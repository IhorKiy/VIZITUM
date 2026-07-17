import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, TaskPriority, TaskStatus } from "@prisma/client";

import {
  createPaginatedResponse,
  type PaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateTaskRequestBody,
  ListTasksQuery,
  TaskResponse,
  UpdateTaskRequestBody,
} from "./tasks.types";

type TaskWithRelations = Prisma.TaskGetPayload<{
  include: {
    assignedTo: true;
    location: true;
  };
}>;

type TaskCreateData = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  assignedToUserId: string | null;
  locationId: string | null;
  visitId: string | null;
  reportId: string | null;
  dueDate: Date | null;
};

type TaskUpdateData = Partial<
  TaskCreateData & {
    status: TaskStatus;
    completedAt: Date | null;
  }
>;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listTasks(
    context: RequestContext,
    query: ListTasksQuery,
  ): Promise<PaginatedResponse<TaskResponse>> {
    const pagination = resolvePagination(query);
    const where = buildTaskWhere(context, query);
    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.task.count({ where }),
    ]);

    return createPaginatedResponse(
      tasks.map(toTaskResponse),
      pagination,
      total,
    );
  }

  async createTask(
    context: RequestContext,
    body: CreateTaskRequestBody,
  ): Promise<TaskResponse> {
    if (!context.permissions.includes(PERMISSIONS.TASKS_CREATE)) {
      throwMissingTaskPermission();
    }

    const data = parseCreateTaskBody(body);

    await this.assertTaskReferences(context.tenantId, data);

    const task = await this.prisma.task.create({
      data: {
        tenantId: context.tenantId,
        createdByUserId: context.userId,
        ...data,
      },
      include: taskInclude,
    });

    return toTaskResponse(task);
  }

  async updateTask(
    context: RequestContext,
    taskId: string,
    body: UpdateTaskRequestBody,
  ): Promise<TaskResponse> {
    const task = await this.findTenantTask(context.tenantId, taskId);

    this.assertCanUpdateTask(context, task.assignedToUserId);

    const data = parseUpdateTaskBody(body);

    await this.assertTaskReferences(context.tenantId, data);

    const updatedTask = await this.prisma.task.update({
      where: { id: task.id },
      data: {
        ...data,
        ...(data.status === "done" && body.completedAt === undefined
          ? { completedAt: new Date() }
          : {}),
        ...(data.status &&
        data.status !== "done" &&
        body.completedAt === undefined
          ? { completedAt: null }
          : {}),
      },
      include: taskInclude,
    });

    return toTaskResponse(updatedTask);
  }

  async deleteTask(
    context: RequestContext,
    taskId: string,
  ): Promise<{ deleted: true }> {
    const task = await this.findTenantTask(context.tenantId, taskId);

    if (!context.permissions.includes(PERMISSIONS.TASKS_UPDATE_TEAM)) {
      throwMissingTaskPermission();
    }

    // Soft delete: `deletedAt` hides the task from every read path (both
    // `findTenantTask` and `buildTaskWhere` filter `deletedAt: null`) while
    // preserving the row, so a mistaken delete stays recoverable.
    await this.prisma.task.update({
      where: { id: task.id },
      data: { deletedAt: new Date() },
    });

    await this.auditService.recordEvent(context, {
      entityType: "task",
      entityId: task.id,
      eventType: "task.deleted",
    });

    return { deleted: true };
  }

  private async findTenantTask(
    tenantId: string,
    taskId: string,
  ): Promise<TaskWithRelations> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        deletedAt: null,
      },
      include: taskInclude,
    });

    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task was not found.",
      });
    }

    return task;
  }

  private assertCanUpdateTask(
    context: RequestContext,
    assignedToUserId: string | null,
  ): void {
    if (context.permissions.includes(PERMISSIONS.TASKS_UPDATE_TEAM)) {
      return;
    }

    if (
      context.permissions.includes(PERMISSIONS.TASKS_UPDATE_OWN) &&
      context.userId &&
      assignedToUserId === context.userId
    ) {
      return;
    }

    throwMissingTaskPermission();
  }

  private async assertTaskReferences(
    tenantId: string,
    data: Partial<TaskCreateData>,
  ): Promise<void> {
    await Promise.all([
      data.assignedToUserId
        ? this.assertTenantUser(tenantId, data.assignedToUserId)
        : Promise.resolve(),
      data.locationId
        ? this.assertTenantLocation(tenantId, data.locationId)
        : Promise.resolve(),
      data.visitId
        ? this.assertTenantVisit(tenantId, data.visitId)
        : Promise.resolve(),
      data.reportId
        ? this.assertTenantReport(tenantId, data.reportId)
        : Promise.resolve(),
    ]);
  }

  private async assertTenantUser(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
        status: { not: "deleted" },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException({
        code: "TASK_ASSIGNEE_INVALID",
        message: "Task assignee must exist in this tenant.",
      });
    }
  }

  private async assertTenantLocation(
    tenantId: string,
    locationId: string,
  ): Promise<void> {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!location) {
      throw new BadRequestException({
        code: "TASK_LOCATION_INVALID",
        message: "Task location must exist in this tenant.",
      });
    }
  }

  private async assertTenantVisit(
    tenantId: string,
    visitId: string,
  ): Promise<void> {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, tenantId },
      select: { id: true },
    });

    if (!visit) {
      throw new BadRequestException({
        code: "TASK_VISIT_INVALID",
        message: "Task visit must exist in this tenant.",
      });
    }
  }

  private async assertTenantReport(
    tenantId: string,
    reportId: string,
  ): Promise<void> {
    const report = await this.prisma.report.findFirst({
      where: { id: reportId, tenantId },
      select: { id: true },
    });

    if (!report) {
      throw new BadRequestException({
        code: "TASK_REPORT_INVALID",
        message: "Task report must exist in this tenant.",
      });
    }
  }
}

const taskInclude = {
  assignedTo: true,
  location: true,
} satisfies Prisma.TaskInclude;

function buildTaskWhere(
  context: RequestContext,
  query: ListTasksQuery,
): Prisma.TaskWhereInput {
  const requestedAssigneeId = normalizeId(query.assignedToUserId);
  const assignedToFilter = context.permissions.includes(
    PERMISSIONS.TASKS_READ_TEAM,
  )
    ? requestedAssigneeId
    : context.userId;

  if (
    !assignedToFilter &&
    !context.permissions.includes(PERMISSIONS.TASKS_READ_TEAM)
  ) {
    throwMissingTaskPermission();
  }

  const dueDate = buildDateOnlyRangeFilter(query.dueFrom, query.dueTo);

  return {
    tenantId: context.tenantId,
    deletedAt: null,
    ...(assignedToFilter ? { assignedToUserId: assignedToFilter } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.locationId ? { locationId: query.locationId } : {}),
    ...(query.visitId ? { visitId: query.visitId } : {}),
    ...(query.routePlanId
      ? {
          visit: {
            tenantId: context.tenantId,
            routeItem: {
              tenantId: context.tenantId,
              routePlanId: query.routePlanId,
            },
          },
        }
      : {}),
    ...(dueDate ? { dueDate } : {}),
  };
}

function parseCreateTaskBody(body: CreateTaskRequestBody): TaskCreateData {
  const title = normalizeRequiredString(body.title);

  if (!title) {
    throw new BadRequestException({
      code: "TASK_INVALID",
      message: "Task title is required.",
      fieldErrors: { title: ["Title is required."] },
    });
  }

  return {
    title,
    description: normalizeOptionalString(body.description),
    priority: normalizeTaskPriority(body.priority) ?? "normal",
    assignedToUserId: normalizeOptionalId(body.assignedToUserId),
    locationId: normalizeOptionalId(body.locationId),
    visitId: normalizeOptionalId(body.visitId),
    reportId: normalizeOptionalId(body.reportId),
    dueDate: parseOptionalDateOnly(body.dueDate),
  };
}

function parseUpdateTaskBody(body: UpdateTaskRequestBody): TaskUpdateData {
  return {
    ...(body.title !== undefined
      ? { title: normalizeRequiredPatchString(body.title, "title") }
      : {}),
    ...(body.description !== undefined
      ? { description: normalizeOptionalString(body.description) }
      : {}),
    ...(body.priority !== undefined
      ? { priority: normalizeTaskPriority(body.priority) ?? "normal" }
      : {}),
    ...(body.assignedToUserId !== undefined
      ? { assignedToUserId: normalizeOptionalId(body.assignedToUserId) }
      : {}),
    ...(body.locationId !== undefined
      ? { locationId: normalizeOptionalId(body.locationId) }
      : {}),
    ...(body.visitId !== undefined
      ? { visitId: normalizeOptionalId(body.visitId) }
      : {}),
    ...(body.reportId !== undefined
      ? { reportId: normalizeOptionalId(body.reportId) }
      : {}),
    ...(body.dueDate !== undefined
      ? { dueDate: parseOptionalDateOnly(body.dueDate) }
      : {}),
    ...(body.status !== undefined
      ? { status: normalizeTaskStatus(body.status) ?? "open" }
      : {}),
    ...(body.completedAt !== undefined
      ? { completedAt: parseOptionalDateTime(body.completedAt) }
      : {}),
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeOptionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return normalizeId(value);
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeRequiredPatchString(value: unknown, field: string): string {
  const normalizedValue = normalizeRequiredString(value);
  if (!normalizedValue) {
    throw new BadRequestException({
      code: "TASK_INVALID",
      message: "Task field is invalid.",
      fieldErrors: { [field]: ["Value cannot be empty."] },
    });
  }
  return normalizedValue;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const normalizedValue = value.trim();
  return normalizedValue || null;
}

function normalizeTaskStatus(value: unknown): TaskStatus | null {
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  ) {
    return value;
  }
  return null;
}

function normalizeTaskPriority(value: unknown): TaskPriority | null {
  if (value === "low" || value === "normal" || value === "high") return value;
  return null;
}

function parseOptionalDateOnly(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date value must use YYYY-MM-DD format.",
    });
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function buildDateOnlyRangeFilter(
  fromValue: unknown,
  toValue: unknown,
): Prisma.DateTimeNullableFilter | undefined {
  const gte = parseDateOnlyBoundary(fromValue, "start");
  const lte = parseDateOnlyBoundary(toValue, "end");

  if (!gte && !lte) {
    return undefined;
  }

  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

function parseDateOnlyBoundary(
  value: unknown,
  boundary: "start" | "end",
): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
    });
  }

  const suffix = boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  const date = new Date(`${value}${suffix}`);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATE_INVALID",
      message: "Date filters must use YYYY-MM-DD format.",
    });
  }

  return date;
}

function parseOptionalDateTime(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: "DATETIME_INVALID",
      message: "Date time value must be an ISO string.",
    });
  }
  return date;
}

function toTaskResponse(task: TaskWithRelations): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedToUserId: task.assignedToUserId,
    assignedTo: task.assignedTo
      ? {
          id: task.assignedTo.id,
          email: task.assignedTo.email,
          name: task.assignedTo.name,
        }
      : null,
    createdByUserId: task.createdByUserId,
    locationId: task.locationId,
    location: task.location
      ? {
          id: task.location.id,
          name: task.location.name,
          addressLine: task.location.addressLine,
          city: task.location.city,
        }
      : null,
    visitId: task.visitId,
    reportId: task.reportId,
    dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function throwMissingTaskPermission(): never {
  throw new ForbiddenException({
    code: "TASK_SCOPE_FORBIDDEN",
    message: "You cannot access this task.",
  });
}
