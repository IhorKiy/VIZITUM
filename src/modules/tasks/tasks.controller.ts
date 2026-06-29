import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TaskPriority, TaskStatus } from "@prisma/client";
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
      priority: parseTaskPriority(query.priority),
      locationId: normalizeQueryString(query.locationId),
      visitId: normalizeQueryString(query.visitId),
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
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

function parseTaskPriority(
  value: string | undefined,
): TaskPriority | undefined {
  if (value === "low" || value === "normal" || value === "high") return value;
  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue || undefined;
}
