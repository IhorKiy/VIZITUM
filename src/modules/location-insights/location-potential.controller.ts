import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
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
import type { RequestContext } from "../tenancy/request-context";
import { UpsertLocationPotentialDto } from "./location-potential.dto";
import { LocationPotentialService } from "./location-potential.service";

@Controller("locations")
@UseGuards(PermissionGuard)
export class LocationPotentialController {
  constructor(
    private readonly locationPotentialService: LocationPotentialService,
  ) {}

  @Get(":locationId/potential")
  @RequirePermissions(PERMISSIONS.LOCATION_INSIGHTS_READ)
  listPotential(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationPotentialService.listPotential(
      getRequestContext(request),
      locationId,
    );
  }

  @Put(":locationId/potential/:productCategoryId")
  @RequireAnyPermissions(
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE,
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN,
  )
  // First module on the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route only, not a
  // global ValidationPipe.
  @UsePipes(createStrictValidationPipe())
  upsertPotential(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productCategoryId") productCategoryId: string,
    @Body() body: UpsertLocationPotentialDto,
  ) {
    return this.locationPotentialService.upsertPotential(
      getRequestContext(request),
      locationId,
      productCategoryId,
      body,
    );
  }

  @Delete(":locationId/potential/:productCategoryId")
  @RequireAnyPermissions(
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE,
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN,
  )
  deletePotential(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productCategoryId") productCategoryId: string,
  ) {
    return this.locationPotentialService.deletePotential(
      getRequestContext(request),
      locationId,
      productCategoryId,
    );
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
