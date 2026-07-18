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
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { LocationCategoriesService } from "./location-categories.service";
import type {
  CreateLocationCategoryRequestBody,
  UpdateLocationCategoryRequestBody,
} from "./locations.types";

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
  createCategory(
    @Req() request: Request,
    @Body() body: CreateLocationCategoryRequestBody,
  ) {
    return this.locationCategoriesService.createCategory(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":categoryId")
  @RequirePermissions(PERMISSIONS.LOCATIONS_MANAGE)
  updateCategory(
    @Req() request: Request,
    @Param("categoryId") categoryId: string,
    @Body() body: UpdateLocationCategoryRequestBody,
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

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
