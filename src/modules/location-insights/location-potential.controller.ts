import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { LocationPotentialService } from "./location-potential.service";
import type { UpsertLocationPotentialRequestBody } from "./location-insights.types";

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
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
  )
  upsertPotential(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productCategoryId") productCategoryId: string,
    @Body() body: UpsertLocationPotentialRequestBody,
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
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
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
