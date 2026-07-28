import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TaskStatus } from "@prisma/client";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { TasksService } from "./tasks.service";
import type {
  CreateTaskRequestBody,
  UpdateTaskRequestBody,
} from "./tasks.types";

@Controller("tasks")
@UseGuards(PermissionGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  @RequireAnyPermissions(
    PERMISSIONS.TASKS_READ_OWN,
    PERMISSIONS.TASKS_READ_TEAM,
  )
  listTasks(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.tasksService.listTasks(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      assignedToUserId: normalizeQueryString(query.assignedToUserId),
      status: parseTaskStatus(query.status),
      isPriority: parseBooleanQueryParam(query.isPriority),
      locationId: normalizeQueryString(query.locationId),
      visitId: normalizeQueryString(query.visitId),
      routePlanId: normalizeQueryString(query.routePlanId),
      dueFrom: normalizeQueryString(query.dueFrom),
      dueTo: normalizeQueryString(query.dueTo),
      completedFrom: normalizeQueryString(query.completedFrom),
      completedTo: normalizeQueryString(query.completedTo),
    });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TASKS_CREATE)
  createTask(@Req() request: Request, @Body() body: CreateTaskRequestBody) {
    return this.tasksService.createTask(getRequestContext(request), body);
  }

  @Patch(":taskId")
  @RequireAnyPermissions(
    PERMISSIONS.TASKS_UPDATE_OWN,
    PERMISSIONS.TASKS_UPDATE_TEAM,
  )
  updateTask(
    @Req() request: Request,
    @Param("taskId") taskId: string,
    @Body() body: UpdateTaskRequestBody,
  ) {
    return this.tasksService.updateTask(
      getRequestContext(request),
      taskId,
      body,
    );
  }

  // Deletion is for tasks that should never have existed; a task that was
  // real and is no longer wanted gets marked `done` instead, which keeps it
  // in the history. Only team scope may delete: an assignee removing their
  // own task would take it out of the manager's list with no trace.
  @Delete(":taskId")
  @RequirePermissions(PERMISSIONS.TASKS_UPDATE_TEAM)
  deleteTask(@Req() request: Request, @Param("taskId") taskId: string) {
    return this.tasksService.deleteTask(getRequestContext(request), taskId);
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }
  return request.context;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

function parseTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (value === "in_progress" || value === "done") {
    return value;
  }
  return undefined;
}

function parseBooleanQueryParam(
  value: string | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue || undefined;
}
