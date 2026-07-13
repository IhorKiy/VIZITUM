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
import type { ProductStatus } from "@prisma/client";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { ProductsService } from "./products.service";
import type {
  CreateProductRequestBody,
  UpdateProductRequestBody,
} from "./products.types";

@Controller("products")
@UseGuards(PermissionGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  listProducts(
    @Req() request: Request,
    @Query() query: Record<string, string>,
  ) {
    return this.productsService.listProducts(getRequestContext(request), {
      page: parsePositiveInteger(query.page),
      pageSize: parsePositiveInteger(query.pageSize),
      status: parseProductStatus(query.status),
      category: normalizeQueryString(query.category),
      search: normalizeQueryString(query.search),
    });
  }

  @Get(":productId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  getProduct(@Req() request: Request, @Param("productId") productId: string) {
    return this.productsService.getProduct(
      getRequestContext(request),
      productId,
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  createProduct(
    @Req() request: Request,
    @Body() body: CreateProductRequestBody,
  ) {
    return this.productsService.createProduct(getRequestContext(request), body);
  }

  @Patch(":productId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateProduct(
    @Req() request: Request,
    @Param("productId") productId: string,
    @Body() body: UpdateProductRequestBody,
  ) {
    return this.productsService.updateProduct(
      getRequestContext(request),
      productId,
      body,
    );
  }

  @Delete(":productId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  deleteProduct(
    @Req() request: Request,
    @Param("productId") productId: string,
  ) {
    return this.productsService.deleteProduct(
      getRequestContext(request),
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

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

function parseProductStatus(
  value: string | undefined,
): ProductStatus | undefined {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return undefined;
}

function normalizeQueryString(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue || undefined;
}
