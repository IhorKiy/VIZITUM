import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, TaskStatus } from "@prisma/client";

import {
  createPaginatedResponse,
  resolvePagination,
} from "../../common/pagination";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateTaskRequestBody,
  ListTasksQuery,
  ListTasksResponse,
  TaskCompletedPeriodResponse,
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
  ): Promise<ListTasksResponse> {
    const pagination = resolvePagination(query);
    const completedRange = resolveTaskCompletedRange(
      query.completedFrom,
      query.completedTo,
    );
    const where = buildTaskWhere(context, query, completedRange);
    const [tasks, total, completedHistoryStart] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: taskOrderBy(query.status),
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.task.count({ where }),
      // Only a windowed list has an end to walk to, so only a windowed list
      // pays for knowing where the walk stops.
      completedRange
        ? this.findCompletedHistoryStart(context, query)
        : Promise.resolve(undefined),
    ]);

    return {
      ...createPaginatedResponse(tasks.map(toTaskResponse), pagination, total),
      ...(completedRange
        ? {
            completedPeriod: toTaskCompletedPeriodResponse(completedRange),
            completedHistoryStart: completedHistoryStart?.toISOString() ?? null,
          }
        : {}),
    };
  }

  /**
   * When the earliest task in this exact scope was finished, or null when the
   * scope holds no finished task at all — deliberately unbounded in time.
   *
   * The clamp caps how long one window may be, not how far back a window may
   * point, so "twelve months ago" is the bottom of nothing. Without this a
   * screen cannot tell "this window is empty, keep walking back" from "there
   * was never anything here", and a representative who has finished nothing
   * gets an endless walk through empty windows.
   *
   * `MIN(completedAt)` over the same scope columns the done list filters on is
   * what the completedAt indexes are sorted by, so Postgres answers it from the
   * index rather than by scanning the scope.
   */
  private async findCompletedHistoryStart(
    context: RequestContext,
    query: ListTasksQuery,
  ): Promise<Date | null> {
    const scope = await this.prisma.task.aggregate({
      where: buildTaskWhere(context, query, null),
      _min: { completedAt: true },
    });

    return scope._min.completedAt;
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

/**
 * The longest a single completion window may be. Same ceiling as the visit
 * period (VISIT_PERIOD_MAX_MONTHS), and the same meaning: a cost ceiling on
 * one request, never a horizon on the data. A range two years back is answered
 * as asked, as long as it is short enough.
 *
 * Unlike visits, this is *not* applied to every task query. A visit belongs to
 * a moment, so flooring every visit read is free; an open task belongs to no
 * moment at all — it is open until someone closes it — so a floor on any task
 * timestamp would hide exactly the stale work a list exists to surface. Only a
 * window the caller actually asked for is trimmed.
 */
export const TASK_COMPLETED_PERIOD_MAX_MONTHS = 12;

export type TaskCompletedRange = { gte: Date; lte?: Date };

/**
 * The completion window a query runs over: the requested range, trimmed to at
 * most TASK_COMPLETED_PERIOD_MAX_MONTHS measured back from its own upper bound
 * (or from now, when the caller named no end). `null` when nothing was asked
 * for, which leaves the list unwindowed.
 *
 * The floor lands on the start of its day, for the reason the visit clamp
 * documents: `completedTo` becomes 23:59:59.999, so subtracting months from an
 * end bound would otherwise put the floor at 23:59:59.999 too and leave the
 * boundary day existing for a single millisecond.
 */
export function resolveTaskCompletedRange(
  fromValue: unknown,
  toValue: unknown,
  now: Date = new Date(),
): TaskCompletedRange | null {
  const gte = parseDateOnlyBoundary(fromValue, "start");
  const lte = parseDateOnlyBoundary(toValue, "end");

  if (!gte && !lte) {
    return null;
  }

  const windowEnd = lte ?? now;
  const earliest = startOfUtcDay(
    subtractMonths(windowEnd, TASK_COMPLETED_PERIOD_MAX_MONTHS),
  );

  return {
    gte: gte && gte.getTime() > earliest.getTime() ? gte : earliest,
    ...(lte ? { lte } : {}),
  };
}

function subtractMonths(value: Date, months: number): Date {
  const shifted = new Date(value.getTime());

  shifted.setUTCMonth(shifted.getUTCMonth() - months);

  return shifted;
}

function startOfUtcDay(value: Date): Date {
  const start = new Date(value.getTime());

  start.setUTCHours(0, 0, 0, 0);

  return start;
}

function toTaskCompletedPeriodResponse(
  range: TaskCompletedRange,
): TaskCompletedPeriodResponse {
  return {
    completedFrom: range.gte.toISOString(),
    completedTo: range.lte ? range.lte.toISOString() : null,
  };
}

/**
 * Open work is ordered by when it is owed — the soonest deadline first, which
 * is the order someone works through it in. Finished work has no deadline left
 * to meet, and the same ordering would head a done list with its oldest
 * deadlines; what a person asks of a finished list is "what did I close
 * lately", so it reads newest-completion-first.
 *
 * `nulls: "last"` covers the column being nullable rather than a row this can
 * actually meet: a backfill migration
 * (20260721150000_task_done_completed_at_backfill) made every done task carry a
 * completedAt, and the app has always stamped one on the transition.
 */
export function taskOrderBy(
  status: TaskStatus | undefined,
): Prisma.TaskOrderByWithRelationInput[] {
  if (status === "done") {
    return [
      { completedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ];
  }

  return [{ dueDate: "asc" }, { createdAt: "desc" }];
}

function buildTaskWhere(
  context: RequestContext,
  query: ListTasksQuery,
  completedRange: TaskCompletedRange | null,
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
    ...buildCompletedFilter(completedRange, query.status),
  };
}

/**
 * How a completion window cuts a list, which depends on what the list holds.
 *
 * A done-only list is simply the window. A mixed list — the manager's "all
 * tasks" view — cannot be, because open tasks have no completedAt and the
 * window would empty them out along with the old finished ones. What that view
 * means by a period is "everything still open, plus what was closed in these
 * days", so open work rides through on `completedAt: null` while finished work
 * is bounded. Open tasks need no window of their own: there are as many as
 * there is work outstanding.
 */
export function buildCompletedFilter(
  completedRange: TaskCompletedRange | null,
  status: TaskStatus | undefined,
): Prisma.TaskWhereInput {
  if (!completedRange) {
    return {};
  }

  if (status === "done") {
    return { completedAt: completedRange };
  }

  return { OR: [{ completedAt: null }, { completedAt: completedRange }] };
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
