import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, TaskStatus } from "@prisma/client";

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
  include: typeof taskInclude;
}>;

type TaskScopeSnapshot = {
  id: string;
  assignedToUserId: string | null;
  status: TaskStatus;
};

type TaskCreateData = {
  title: string;
  description: string | null;
  isPriority: boolean;
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

    this.assertCanAssignTask(context, data.assignedToUserId);

    await this.assertTaskReferences(context.tenantId, data);

    // Task creation and its opening history row must land together: a task
    // must never exist without the "created by X" trail that anchors its
    // history block, and vice versa.
    const created = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          tenantId: context.tenantId,
          createdByUserId: context.userId,
          ...data,
        },
      });

      await tx.taskStatusHistory.create({
        data: {
          tenantId: context.tenantId,
          taskId: task.id,
          changedByUserId: context.userId,
          oldStatus: null,
          newStatus: task.status,
        },
      });

      return tx.task.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });
    });

    return toTaskResponse(created);
  }

  async updateTask(
    context: RequestContext,
    taskId: string,
    body: UpdateTaskRequestBody,
  ): Promise<TaskResponse> {
    const task = await this.findTenantTask(context.tenantId, taskId);

    this.assertCanUpdateTask(context, task.assignedToUserId);

    const data = parseUpdateTaskBody(body);

    // Own-scope callers are restricted on create to assigning only
    // themselves (see assertCanAssignTask) — without this, a PATCH that
    // touches assignedToUserId would trivially undo that restriction, since
    // assertCanUpdateTask above only checks the task's *current* assignee,
    // not the one being set.
    if (data.assignedToUserId !== undefined) {
      this.assertCanAssignTask(context, data.assignedToUserId);
    }

    await this.assertTaskReferences(context.tenantId, data);

    const statusChanged =
      data.status !== undefined && data.status !== task.status;

    // The status change and its history row must commit or roll back
    // together, same invariant as task creation above.
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
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
      });

      if (statusChanged) {
        await tx.taskStatusHistory.create({
          data: {
            tenantId: context.tenantId,
            taskId: task.id,
            changedByUserId: context.userId,
            oldStatus: task.status,
            newStatus: updatedTask.status,
          },
        });
      }

      return tx.task.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });
    });

    return toTaskResponse(updated);
  }

  async deleteTask(
    context: RequestContext,
    taskId: string,
  ): Promise<{ deleted: true }> {
    if (!context.permissions.includes(PERMISSIONS.TASKS_UPDATE_TEAM)) {
      throwMissingTaskPermission();
    }

    const task = await this.findTenantTask(context.tenantId, taskId);

    // Soft delete: `deletedAt` hides the task from every read path (both
    // `findTenantTask` and `buildTaskWhere` filter `deletedAt: null`) while
    // preserving the row, so a mistaken delete stays recoverable. One
    // transaction with the audit event: a delete must never exist without
    // its `task.deleted` trail, nor a trail without the delete. This is a
    // separate admin trail (AuditEvent), not the status-change history.
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { deletedAt: new Date() },
      });

      await this.auditService.recordEvent(
        context,
        {
          entityType: "task",
          entityId: task.id,
          eventType: "task.deleted",
        },
        tx,
      );
    });

    return { deleted: true };
  }

  private async findTenantTask(
    tenantId: string,
    taskId: string,
  ): Promise<TaskScopeSnapshot> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true, assignedToUserId: true, status: true },
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

  // A caller with only own-scope task permissions (no tasks.read_team or
  // tasks.update_team) has no notion of a "team" to assign work to — they
  // may only create or reassign a task to themselves, and may not leave one
  // unassigned (an unassigned task would be invisible to them on every later
  // own-scope list/update call, effectively orphaning it). Checked on every
  // assignedToUserId a caller like this tries to set, whether on create or
  // via a later PATCH — otherwise the create-time restriction is a no-op,
  // trivially undone by reassigning right after.
  private assertCanAssignTask(
    context: RequestContext,
    assignedToUserId: string | null,
  ): void {
    const hasTeamScope =
      context.permissions.includes(PERMISSIONS.TASKS_READ_TEAM) ||
      context.permissions.includes(PERMISSIONS.TASKS_UPDATE_TEAM);

    if (hasTeamScope) {
      return;
    }

    if (context.userId && assignedToUserId === context.userId) {
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
  createdBy: true,
  location: true,
  statusHistory: {
    orderBy: { createdAt: "asc" },
    include: { changedBy: true },
  },
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
    ...(query.isPriority !== undefined ? { isPriority: query.isPriority } : {}),
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
    isPriority: normalizeIsPriority(body.isPriority),
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
    ...(body.isPriority !== undefined
      ? { isPriority: normalizeIsPriority(body.isPriority) }
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
      ? { status: normalizeTaskStatus(body.status) ?? "in_progress" }
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
  if (value === "in_progress" || value === "done") {
    return value;
  }
  return null;
}

function normalizeIsPriority(value: unknown): boolean {
  return value === true;
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
    isPriority: task.isPriority,
    assignedToUserId: task.assignedToUserId,
    assignedTo: task.assignedTo
      ? {
          id: task.assignedTo.id,
          email: task.assignedTo.email,
          name: task.assignedTo.name,
        }
      : null,
    createdByUserId: task.createdByUserId,
    createdBy: task.createdBy
      ? {
          id: task.createdBy.id,
          email: task.createdBy.email,
          name: task.createdBy.name,
        }
      : null,
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
    history: task.statusHistory.map((entry) => ({
      id: entry.id,
      changedByUserId: entry.changedByUserId,
      changedBy: entry.changedBy
        ? {
            id: entry.changedBy.id,
            email: entry.changedBy.email,
            name: entry.changedBy.name,
          }
        : null,
      oldStatus: entry.oldStatus,
      newStatus: entry.newStatus,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

function throwMissingTaskPermission(): never {
  throw new ForbiddenException({
    code: "TASK_SCOPE_FORBIDDEN",
    message: "You cannot access this task.",
  });
}
