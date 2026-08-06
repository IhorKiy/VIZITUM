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
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import {
  CreateLocationAssignmentDto,
  CreateLocationDto,
  UpdateLocationDto,
  UpdateLocationNotesDto,
  UpsertLocationContactDto,
} from "./locations.dto";
import { LocationsService } from "./locations.service";
import type { LocationListStatus } from "./locations.types";

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
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createLocation(@Req() request: Request, @Body() body: CreateLocationDto) {
    return this.locationsService.createLocation(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":locationId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateLocation(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: UpdateLocationDto,
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

  @Patch(":locationId/notes")
  @RequireAnyPermissions(
    PERMISSIONS.LOCATION_NOTES_MANAGE,
    PERMISSIONS.LOCATION_NOTES_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  updateLocationNotes(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: UpdateLocationNotesDto,
  ) {
    return this.locationsService.updateLocationNotes(
      getRequestContext(request),
      locationId,
      body,
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
  @RequireAnyPermissions(
    PERMISSIONS.CONTACTS_MANAGE,
    PERMISSIONS.CONTACTS_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  createContact(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: UpsertLocationContactDto,
  ) {
    return this.locationsService.createContact(
      getRequestContext(request),
      locationId,
      body,
    );
  }

  @Patch(":locationId/contacts/:contactId")
  @RequireAnyPermissions(
    PERMISSIONS.CONTACTS_MANAGE,
    PERMISSIONS.CONTACTS_MANAGE_OWN,
  )
  @UsePipes(createStrictValidationPipe())
  updateContact(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("contactId") contactId: string,
    @Body() body: UpsertLocationContactDto,
  ) {
    return this.locationsService.updateContact(
      getRequestContext(request),
      locationId,
      contactId,
      body,
    );
  }

  @Delete(":locationId/contacts/:contactId")
  @RequireAnyPermissions(
    PERMISSIONS.CONTACTS_MANAGE,
    PERMISSIONS.CONTACTS_MANAGE_OWN,
  )
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
  @UsePipes(createStrictValidationPipe())
  createAssignment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Body() body: CreateLocationAssignmentDto,
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
