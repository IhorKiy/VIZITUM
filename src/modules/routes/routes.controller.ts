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
  UsePipes,
} from "@nestjs/common";
import type { RouteStatus } from "@prisma/client";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  CreateRouteItemDto,
  CreateRoutePlanDto,
  ReorderRouteItemsDto,
  UpdateRouteItemDto,
  UpdateRoutePlanDto,
} from "./routes.dto";
import { RoutesService } from "./routes.service";

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
      planDateFrom: normalizeQueryString(query.planDateFrom),
      planDateTo: normalizeQueryString(query.planDateTo),
      status: parseRouteStatus(query.status),
    });
  }

  @Post()
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  // Tier 3 of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createRoutePlan(@Req() request: Request, @Body() body: CreateRoutePlanDto) {
    return this.routesService.createRoutePlan(getRequestContext(request), body);
  }

  @Patch(":routePlanId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  updateRoutePlan(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Body() body: UpdateRoutePlanDto,
  ) {
    return this.routesService.updateRoutePlan(
      getRequestContext(request),
      routePlanId,
      body,
    );
  }

  @Delete(":routePlanId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  deleteRoutePlan(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
  ) {
    return this.routesService.deleteRoutePlan(
      getRequestContext(request),
      routePlanId,
    );
  }

  @Post(":routePlanId/items")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  createRouteItem(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Body() body: CreateRouteItemDto,
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
  @UsePipes(createStrictValidationPipe())
  updateRouteItem(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Param("routeItemId") routeItemId: string,
    @Body() body: UpdateRouteItemDto,
  ) {
    return this.routesService.updateRouteItem(
      getRequestContext(request),
      routePlanId,
      routeItemId,
      body,
    );
  }

  @Delete(":routePlanId/items/:routeItemId")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  deleteRouteItem(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Param("routeItemId") routeItemId: string,
  ) {
    return this.routesService.deleteRouteItem(
      getRequestContext(request),
      routePlanId,
      routeItemId,
    );
  }

  @Post(":routePlanId/items/reorder")
  @RequireAnyPermissions(
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.ROUTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  reorderRouteItems(
    @Req() request: Request,
    @Param("routePlanId") routePlanId: string,
    @Body() body: ReorderRouteItemsDto,
  ) {
    return this.routesService.reorderRouteItems(
      getRequestContext(request),
      routePlanId,
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
