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
import { LocationAssortmentService } from "./location-assortment.service";
import type { UpsertLocationAssortmentRequestBody } from "./location-insights.types";

@Controller("locations")
@UseGuards(PermissionGuard)
export class LocationAssortmentController {
  constructor(
    private readonly locationAssortmentService: LocationAssortmentService,
  ) {}

  @Get(":locationId/assortment")
  @RequirePermissions(PERMISSIONS.LOCATION_INSIGHTS_READ)
  listAssortment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
  ) {
    return this.locationAssortmentService.listAssortment(
      getRequestContext(request),
      locationId,
    );
  }

  @Put(":locationId/assortment/:productId")
  @RequireAnyPermissions(
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
  )
  upsertAssortment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productId") productId: string,
    @Body() body: UpsertLocationAssortmentRequestBody,
  ) {
    return this.locationAssortmentService.upsertAssortment(
      getRequestContext(request),
      locationId,
      productId,
      body,
    );
  }

  @Delete(":locationId/assortment/:productId")
  @RequireAnyPermissions(
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
  )
  deleteAssortment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productId") productId: string,
  ) {
    return this.locationAssortmentService.deleteAssortment(
      getRequestContext(request),
      locationId,
      productId,
    );
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
