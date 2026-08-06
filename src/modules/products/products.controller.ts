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
import type { ProductStatus } from "@prisma/client";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { CreateProductDto, UpdateProductDto } from "./products.dto";
import { ProductsService } from "./products.service";

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
  // Flat-CRUD tier of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  createProduct(@Req() request: Request, @Body() body: CreateProductDto) {
    return this.productsService.createProduct(getRequestContext(request), body);
  }

  @Patch(":productId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateProduct(
    @Req() request: Request,
    @Param("productId") productId: string,
    @Body() body: UpdateProductDto,
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
