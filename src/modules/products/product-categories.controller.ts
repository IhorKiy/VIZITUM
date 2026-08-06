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
import { UpsertProductCategoryDto } from "./product-categories.dto";
import { ProductCategoriesService } from "./product-categories.service";

@Controller("product-categories")
@UseGuards(PermissionGuard)
export class ProductCategoriesController {
  constructor(
    private readonly productCategoriesService: ProductCategoriesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  listCategories(@Req() request: Request) {
    return this.productCategoriesService.listCategories(
      getRequestContext(request),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createCategory(
    @Req() request: Request,
    @Body() body: UpsertProductCategoryDto,
  ) {
    return this.productCategoriesService.createCategory(
      getRequestContext(request),
      body,
    );
  }

  @Patch(":categoryId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateCategory(
    @Req() request: Request,
    @Param("categoryId") categoryId: string,
    @Body() body: UpsertProductCategoryDto,
  ) {
    return this.productCategoriesService.updateCategory(
      getRequestContext(request),
      categoryId,
      body,
    );
  }

  @Delete(":categoryId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  deleteCategory(
    @Req() request: Request,
    @Param("categoryId") categoryId: string,
  ) {
    return this.productCategoriesService.deleteCategory(
      getRequestContext(request),
      categoryId,
    );
  }
}
