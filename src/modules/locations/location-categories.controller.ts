import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { UpsertLocationCategoryDto } from "./location-categories.dto";
import { LocationCategoriesService } from "./location-categories.service";

@Controller("location-categories")
@UseGuards(PermissionGuard)
export class LocationCategoriesController {
  constructor(
    private readonly locationCategoriesService: LocationCategoriesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LOCATIONS_READ)
  listCategories(@Req() request: Request) {
    return this.locationCategoriesService.listCategories(
      getRequestContext(request),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createCategory(
    @Req() request: Request,
    @Body() body: UpsertLocationCategoryDto,
  ) {
    return this.locationCategoriesService.createCategory(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":categoryId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateCategory(
    @Req() request: Request,
    @Param("categoryId") categoryId: string,
    @Body() body: UpsertLocationCategoryDto,
  ) {
    return this.locationCategoriesService.updateCategory(
      getRequestContext(request),
      categoryId,
      body,
    );
  }

  @Delete(":categoryId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  deleteCategory(
    @Req() request: Request,
    @Param("categoryId") categoryId: string,
  ) {
    return this.locationCategoriesService.deleteCategory(
      getRequestContext(request),
      categoryId,
    );
  }
}
