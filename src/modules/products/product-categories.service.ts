import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type ProductCategory } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateProductCategoryRequestBody,
  ProductCategoryResponse,
  UpdateProductCategoryRequestBody,
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

    // Category names are a curated per-tenant vocabulary, so uniqueness is
    // case-insensitive: "Beverages" and "beverages" are the same label. The
    // display name is still stored exactly as typed.
    const existing = await this.prisma.productCategory.findFirst({
      where: {
        tenantId: context.tenantId,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (existing) {
      throw categoryExistsConflict();
    }

    try {
      const category = await this.prisma.productCategory.create({
        data: {
          tenantId: context.tenantId,
          name,
        },
      });

      return toProductCategoryResponse(category);
    } catch (error) {
      // A concurrent create can slip between the findFirst above and this
      // insert; the @@unique([tenantId, name]) index then raises P2002. Surface
      // it as the same 409 the pre-check would have, not an opaque 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw categoryExistsConflict();
      }

      throw error;
    }
  }

  async updateCategory(
    context: RequestContext,
    categoryId: string,
    body: UpdateProductCategoryRequestBody,
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

    const category = await this.prisma.productCategory.findFirst({
      where: { id: categoryId, tenantId: context.tenantId },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new NotFoundException({
        code: "PRODUCT_CATEGORY_NOT_FOUND",
        message: "Category was not found.",
      });
    }

    if (name === category.name) {
      return this.renameCategoryRow(context.tenantId, category.id, name);
    }

    // Case-insensitive collision check against sibling categories. A pure
    // case change of this same category (e.g. "Beverages" -> "BEVERAGES")
    // excludes itself here, so it falls through and updates the display name.
    const existing = await this.prisma.productCategory.findFirst({
      where: {
        tenantId: context.tenantId,
        name: { equals: name, mode: "insensitive" },
        id: { not: category.id },
      },
      select: { id: true },
    });

    if (existing) {
      throw categoryExistsConflict();
    }

    // `Product.category` is a free-text string (no FK), so cascade the rename to
    // every product tagged with the old name to keep the catalog consistent.
    // The match is case-insensitive so products stamped with any case variant of
    // the old label get relabelled to the new canonical display name.
    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.productCategory.update({
          where: { id: category.id },
          data: { name },
        }),
        this.prisma.product.updateMany({
          where: {
            tenantId: context.tenantId,
            category: { equals: category.name, mode: "insensitive" },
          },
          data: { category: name },
        }),
      ]);

      return toProductCategoryResponse(updated);
    } catch (error) {
      // Same race as createCategory: a concurrent insert/rename can claim the
      // name between the probe above and this update, tripping the unique
      // index. Surface it as the same 409 the pre-check would have.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw categoryExistsConflict();
      }

      throw error;
    }
  }

  private async renameCategoryRow(
    tenantId: string,
    categoryId: string,
    name: string,
  ): Promise<ProductCategoryResponse> {
    const updated = await this.prisma.productCategory.update({
      where: { id: categoryId },
      data: { name },
    });

    return toProductCategoryResponse(updated);
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

function categoryExistsConflict(): ConflictException {
  return new ConflictException({
    code: "PRODUCT_CATEGORY_EXISTS",
    message: "Category already exists.",
    fieldErrors: {
      name: ["Category already exists."],
    },
  });
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
