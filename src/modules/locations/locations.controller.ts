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
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { LocationsService } from "./locations.service";
import type {
  CreateLocationAssignmentRequestBody,
  CreateLocationContactRequestBody,
  CreateLocationRequestBody,
  LocationListStatus,
  UpdateLocationContactRequestBody,
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
      territory: normalizeQueryString(query.territory),
      chainId: normalizeQueryString(query.chainId),
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

  @Delete(":locationId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  archiveLocation(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationsService.archiveLocation(
      getRequestContext(request),
      locationId,
    );
  }

  @Post(":locationId/restore")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  restoreLocation(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationsService.restoreLocation(
      getRequestContext(request),
      locationId,
    );
  }

  @Get(":locationId/contacts")
  @RequirePermissions(PERMISSIONS.CONTACTS_READ)
  listContacts(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationsService.listContacts(
      getRequestContext(request),
      locationId,
    );
  }

  @Post(":locationId/contacts")
  @RequirePermissions(PERMISSIONS.CONTACTS_MANAGE)
  createContact(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: CreateLocationContactRequestBody,
  ) {
    return this.locationsService.createContact(
      getRequestContext(request),
      locationId,
      body,
    );
  }

  @Patch(":locationId/contacts/:contactId")
  @RequirePermissions(PERMISSIONS.CONTACTS_MANAGE)
  updateContact(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("contactId") contactId: string,
    @Body() body: UpdateLocationContactRequestBody,
  ) {
    return this.locationsService.updateContact(
      getRequestContext(request),
      locationId,
      contactId,
      body,
    );
  }

  @Delete(":locationId/contacts/:contactId")
  @RequirePermissions(PERMISSIONS.CONTACTS_MANAGE)
  deleteContact(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("contactId") contactId: string,
  ) {
    return this.locationsService.deleteContact(
      getRequestContext(request),
      locationId,
      contactId,
    );
  }

  @Get(":locationId/assignments")
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  listAssignments(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationsService.listAssignments(
      getRequestContext(request),
      locationId,
    );
  }

  @Post(":locationId/assignments")
  @RequirePermissions(PERMISSIONS.LOCATIONS_ASSIGN)
  createAssignment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: CreateLocationAssignmentRequestBody,
  ) {
    return this.locationsService.createAssignment(
      getRequestContext(request),
      locationId,
      body,
    );
  }

  @Patch(":locationId/assignments/:assignmentId/deactivate")
  @RequirePermissions(PERMISSIONS.LOCATIONS_ASSIGN)
  deactivateAssignment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("assignmentId") assignmentId: string,
  ) {
    return this.locationsService.deactivateAssignment(
      getRequestContext(request),
      locationId,
      assignmentId,
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
): LocationListStatus | undefined {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
