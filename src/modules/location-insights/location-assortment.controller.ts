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
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { UpsertLocationAssortmentDto } from "./location-assortment.dto";
import { LocationAssortmentService } from "./location-assortment.service";

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
  @RequirePermissions(PERMISSIONS.LOCATION_ASSORTMENT_MANAGE)
  // Next module on the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route only, not a
  // global ValidationPipe.
  @UsePipes(createStrictValidationPipe())
  upsertAssortment(
    @Req() request: Request,
    @Param("locationId") locationId: string,
    @Param("productId") productId: string,
    @Body() body: UpsertLocationAssortmentDto,
  ) {
    return this.locationAssortmentService.upsertAssortment(
      getRequestContext(request),
      locationId,
      productId,
      body,
    );
  }

  @Delete(":locationId/assortment/:productId")
  @RequirePermissions(PERMISSIONS.LOCATION_ASSORTMENT_MANAGE)
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
