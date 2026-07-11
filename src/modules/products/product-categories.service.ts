import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ProductCategory } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateProductCategoryRequestBody,
  ProductCategoryResponse,
} from "./products.types";

@Injectable()
export class ProductCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(
    context: RequestContext,
  ): Promise<ProductCategoryResponse[]> {
    const categories = await this.prisma.productCategory.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { name: "asc" },
    });

    return categories.map(toProductCategoryResponse);
  }

  async createCategory(
    context: RequestContext,
    body: CreateProductCategoryRequestBody,
  ): Promise<ProductCategoryResponse> {
    const name = normalizeCategoryName(body.name);

    if (!name) {
      throw new BadRequestException({
        code: "PRODUCT_CATEGORY_INVALID",
        message: "Category name is required.",
        fieldErrors: {
          name: ["Name is required."],
        },
      });
    }

    const existing = await this.prisma.productCategory.findFirst({
      where: { tenantId: context.tenantId, name },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: "PRODUCT_CATEGORY_EXISTS",
        message: "Category already exists.",
        fieldErrors: {
          name: ["Category already exists."],
        },
      });
    }

    const category = await this.prisma.productCategory.create({
      data: {
        tenantId: context.tenantId,
        name,
      },
    });

    return toProductCategoryResponse(category);
  }

  async deleteCategory(
    context: RequestContext,
    categoryId: string,
  ): Promise<{ deleted: true }> {
    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, tenantId: context.tenantId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException({
        code: "PRODUCT_CATEGORY_NOT_FOUND",
        message: "Category was not found.",
      });
    }

    await this.prisma.productCategory.delete({ where: { id: category.id } });

    return { deleted: true };
  }
}

function normalizeCategoryName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue || null;
}

function toProductCategoryResponse(
  category: ProductCategory,
): ProductCategoryResponse {
  return {
    id: category.id,
    name: category.name,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}
