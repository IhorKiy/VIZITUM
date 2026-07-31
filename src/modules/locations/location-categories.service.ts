import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type LocationCategory } from "@prisma/client";

import { withinLimit } from "../../common/input-limits";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateLocationCategoryRequestBody,
  LocationCategoryResponse,
  UpdateLocationCategoryRequestBody,
} from "./locations.types";

@Injectable()
export class LocationCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(
    context: RequestContext,
  ): Promise<LocationCategoryResponse[]> {
    const categories = await this.prisma.locationCategory.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { name: "asc" },
    });

    return categories.map(toLocationCategoryResponse);
  }

  async createCategory(
    context: RequestContext,
    body: CreateLocationCategoryRequestBody,
  ): Promise<LocationCategoryResponse> {
    const name = normalizeCategoryName(body.name);

    if (!name) {
      throw new BadRequestException({
        code: "LOCATION_CATEGORY_INVALID",
        message: "Category name is required.",
        fieldErrors: {
          name: ["Name is required."],
        },
      });
    }

    // Category names are a curated per-tenant vocabulary, so uniqueness is
    // case-insensitive: "Bakery" and "bakery" are the same label. The display
    // name is still stored exactly as typed.
    const existing = await this.prisma.locationCategory.findFirst({
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
      const category = await this.prisma.locationCategory.create({
        data: {
          tenantId: context.tenantId,
          name,
        },
      });

      return toLocationCategoryResponse(category);
    } catch (error) {
      // A concurrent create can slip between the findFirst above and this
      // insert; the functional unique index then raises P2002. Surface it as
      // the same 409 the pre-check would have, not an opaque 500.
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
    body: UpdateLocationCategoryRequestBody,
  ): Promise<LocationCategoryResponse> {
    const name = normalizeCategoryName(body.name);

    if (!name) {
      throw new BadRequestException({
        code: "LOCATION_CATEGORY_INVALID",
        message: "Category name is required.",
        fieldErrors: {
          name: ["Name is required."],
        },
      });
    }

    const category = await this.prisma.locationCategory.findFirst({
      where: { id: categoryId, tenantId: context.tenantId },
      select: { id: true, name: true },
    });

    if (!category) {
      throw new NotFoundException({
        code: "LOCATION_CATEGORY_NOT_FOUND",
        message: "Category was not found.",
      });
    }

    if (name === category.name) {
      return this.renameCategoryRow(category.id, name);
    }

    // Case-insensitive collision check against sibling categories. A pure
    // case change of this same category (e.g. "Bakery" -> "BAKERY") excludes
    // itself here, so it falls through and updates the display name.
    const existing = await this.prisma.locationCategory.findFirst({
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

    // Unlike `ProductCategory` (a free-text `Product.category` string with no
    // FK), `Location.categoryId` is a real foreign key — renaming this row is
    // enough, every location pointing at it reads the new name on the next
    // fetch. No cascade update needed.
    try {
      return await this.renameCategoryRow(category.id, name);
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
    categoryId: string,
    name: string,
  ): Promise<LocationCategoryResponse> {
    const updated = await this.prisma.locationCategory.update({
      where: { id: categoryId },
      data: { name },
    });

    return toLocationCategoryResponse(updated);
  }

  async deleteCategory(
    context: RequestContext,
    categoryId: string,
  ): Promise<{ deleted: true }> {
    const category = await this.prisma.locationCategory.findFirst({
      where: { id: categoryId, tenantId: context.tenantId },
      select: { id: true },
    });

    if (!category) {
      throw new NotFoundException({
        code: "LOCATION_CATEGORY_NOT_FOUND",
        message: "Category was not found.",
      });
    }

    // The FK is `onDelete: Restrict`, and Prisma enforces that at the
    // database row level — an archived (soft-deleted) location still blocks
    // the delete just as a live one would. So this count (and the P2003
    // fallback below) must include archived locations too, or the pre-check
    // can read 0 while the delete still fails.
    const locationsInUse = await this.prisma.location.count({
      where: {
        tenantId: context.tenantId,
        categoryId: category.id,
      },
    });

    if (locationsInUse > 0) {
      throw categoryInUseConflict(locationsInUse);
    }

    try {
      await this.prisma.locationCategory.delete({ where: { id: category.id } });
    } catch (error) {
      // A location can be created against this category between the count
      // above and the delete; the `Restrict` FK then raises P2003. Surface it
      // as the same 409 the pre-check would have, not an opaque 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        const currentCount = await this.prisma.location.count({
          where: {
            tenantId: context.tenantId,
            categoryId: category.id,
          },
        });

        throw categoryInUseConflict(currentCount || 1);
      }

      throw error;
    }

    return { deleted: true };
  }
}

function categoryExistsConflict(): ConflictException {
  return new ConflictException({
    code: "LOCATION_CATEGORY_EXISTS",
    message: "Category already exists.",
    fieldErrors: {
      name: ["Category already exists."],
    },
  });
}

function categoryInUseConflict(locationCount: number): ConflictException {
  return new ConflictException({
    code: "LOCATION_CATEGORY_IN_USE",
    message:
      "Category is assigned to one or more locations, including archived ones.",
    details: { locationCount },
  });
}

function normalizeCategoryName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  // Over-length joins blank in the "name is required" field error the caller
  // already raises for a null — the column itself is unbounded `text`.
  if (!normalizedValue || !withinLimit(normalizedValue, "name")) {
    return null;
  }

  return normalizedValue;
}

function toLocationCategoryResponse(
  category: LocationCategory,
): LocationCategoryResponse {
  return {
    id: category.id,
    name: category.name,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}
