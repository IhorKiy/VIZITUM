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
import type { RouteStatus } from "@prisma/client";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { RoutesService } from "./routes.service";
import type {
  CreateRouteItemRequestBody,
  CreateRoutePlanRequestBody,
  UpdateRouteItemRequestBody,
  UpdateRoutePlanRequestBody,
} from "./routes.types";

@Controller("routes")
@UseGuards(PermissionGuard)
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get("today")
  @RequirePermissions(PERMISSIONS.ROUTES_READ)
  getTodayRoutes(@Req() request: Request) {
    return this.routesService.getTodayRoutes(getRequestContext(request));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ROUTES_READ)
  listRoutes(@Req() request: Request, @Query() query: Record<string, string>) {
    return this.routesService.listRoutes(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      representativeUserId: normalizeQueryString(query.representativeUserId),
      planDate: normalizeQueryString(query.planDate),
      status: parseRouteStatus(query.status),
    });
  }

  @Post()
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  createRoutePlan(
    @Req() request: Request,
    @Body() body: CreateRoutePlanRequestBody,
  ) {
    return this.routesService.createRoutePlan(getRequestContext(request), body);
  }

  @Patch(":routePlanId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  updateRoutePlan(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Body() body: UpdateRoutePlanRequestBody,
  ) {
    return this.routesService.updateRoutePlan(
      getRequestContext(request),
      routePlanId,
      body,
    );
  }

  @Post(":routePlanId/items")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  createRouteItem(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Body() body: CreateRouteItemRequestBody,
  ) {
    return this.routesService.createRouteItem(
      getRequestContext(request),
      routePlanId,
      body,
    );
  }

  @Patch(":routePlanId/items/:routeItemId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  updateRouteItem(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Param("routeItemId") routeItemId: string,
    @Body() body: UpdateRouteItemRequestBody,
  ) {
    return this.routesService.updateRouteItem(
      getRequestContext(request),
      routePlanId,
      routeItemId,
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
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

function parseRouteStatus(value: string | undefined): RouteStatus | undefined {
  if (
    value === "draft" ||
    value === "published" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
