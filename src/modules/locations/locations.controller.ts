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
import type { LocationStatus } from "@prisma/client";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { LocationsService } from "./locations.service";
import type {
  CreateLocationRequestBody,
  UpdateLocationRequestBody,
} from "./locations.types";

@Controller("locations")
@UseGuards(PermissionGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  listLocations(
    @Req() request: Request,
    @Query() query: Record<string, string>,
  ) {
    return this.locationsService.listLocations(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      status: parseLocationStatus(query.status),
      city: normalizeQueryString(query.city),
      region: normalizeQueryString(query.region),
      territory: normalizeQueryString(query.territory),
      search: normalizeQueryString(query.search),
    });
  }

  @Get(":locationId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  getLocation(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationsService.getLocation(
      getRequestContext(request),
      locationId,
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  createLocation(
    @Req() request: Request,
    @Body() body: CreateLocationRequestBody,
  ) {
    return this.locationsService.createLocation(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":locationId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  updateLocation(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: UpdateLocationRequestBody,
  ) {
    return this.locationsService.updateLocation(
      getRequestContext(request),
      locationId,
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

function parseLocationStatus(
  value: string | undefined,
): LocationStatus | undefined {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
