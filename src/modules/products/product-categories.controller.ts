import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { ProductCategoriesService } from "./product-categories.service";
import type { CreateProductCategoryRequestBody } from "./products.types";

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
  createCategory(
    @Req() request: Request,
    @Body() body: CreateProductCategoryRequestBody,
  ) {
    return this.productCategoriesService.createCategory(
      getRequestContext(request),
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

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
