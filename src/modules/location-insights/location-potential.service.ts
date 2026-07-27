import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  assertCanManagePotential,
  canManagePotential,
  findTenantLocationOrThrow,
} from "./location-insights-access";
import {
  normalizeOptionalComment,
  normalizeOptionalDateOnly,
  normalizeOptionalNonNegativeInteger,
} from "./location-insights-parsing";
import type {
  ListLocationPotentialResponse,
  LocationPotentialResponse,
  UpsertLocationPotentialRequestBody,
} from "./location-insights.types";

type LocationPotentialRow = {
  id: string;
  locationId: string;
  productCategoryId: string;
  potentialDate: Date | null;
  potentialAmount: number | null;
  planMonth1: number | null;
  planMonth2: number | null;
  planMonth3: number | null;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  productCategory: { id: string; name: string };
};

type LocationPotentialData = {
  potentialDate: Date | null;
  potentialAmount: number | null;
  planMonth1: number | null;
  planMonth2: number | null;
  planMonth3: number | null;
  comment: string | null;
};

const POTENTIAL_INCLUDE = {
  productCategory: { select: { id: true, name: true } },
} as const;

@Injectable()
export class LocationPotentialService {
  constructor(private readonly prisma: PrismaService) {}

  async listPotential(
    context: RequestContext,
    locationId: string,
  ): Promise<ListLocationPotentialResponse> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);

    const [rows, canManage] = await Promise.all([
      this.prisma.locationPotential.findMany({
        where: { tenantId: context.tenantId, locationId },
        include: POTENTIAL_INCLUDE,
        orderBy: { createdAt: "asc" },
      }),
      canManagePotential(context, this.prisma, locationId),
    ]);

    return {
      items: rows.map(toLocationPotentialResponse),
      canManage,
    };
  }

  async upsertPotential(
    context: RequestContext,
    locationId: string,
    productCategoryId: string,
    body: UpsertLocationPotentialRequestBody,
  ): Promise<LocationPotentialResponse> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);
    await assertCanManagePotential(context, this.prisma, locationId);
    await this.findTenantProductCategory(context.tenantId, productCategoryId);

    const data = parseUpsertPotentialBody(body);

    const row = await this.prisma.locationPotential.upsert({
      where: {
        tenantId_locationId_productCategoryId: {
          tenantId: context.tenantId,
          locationId,
          productCategoryId,
        },
      },
      create: {
        tenantId: context.tenantId,
        locationId,
        productCategoryId,
        ...data,
      },
      update: data,
      include: POTENTIAL_INCLUDE,
    });

    return toLocationPotentialResponse(row);
  }

  async deletePotential(
    context: RequestContext,
    locationId: string,
    productCategoryId: string,
  ): Promise<{ deleted: true }> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);
    await assertCanManagePotential(context, this.prisma, locationId);

    const existing = await this.prisma.locationPotential.findFirst({
      where: { tenantId: context.tenantId, locationId, productCategoryId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException({
        code: "LOCATION_POTENTIAL_NOT_FOUND",
        message: "Location potential row was not found.",
      });
    }

    await this.prisma.locationPotential.delete({
      where: { id: existing.id },
    });

    return { deleted: true };
  }

  private async findTenantProductCategory(
    tenantId: string,
    productCategoryId: string,
  ): Promise<void> {
    // ProductCategory has no deletedAt column (a hard-deletable dictionary
    // table) — existence-in-tenant is the whole check.
    const category = await this.prisma.productCategory.findFirst({
      where: { id: productCategoryId, tenantId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException({
        code: "PRODUCT_CATEGORY_INVALID",
        message: "Product category must belong to this tenant.",
        fieldErrors: {
          productCategoryId: ["Must reference a category in this tenant."],
        },
      });
    }
  }
}

function parseUpsertPotentialBody(
  body: UpsertLocationPotentialRequestBody,
): LocationPotentialData {
  return {
    potentialDate: normalizeOptionalDateOnly(
      body.potentialDate,
      "potentialDate",
    ),
    potentialAmount: normalizeOptionalNonNegativeInteger(
      body.potentialAmount,
      "potentialAmount",
    ),
    planMonth1: normalizeOptionalNonNegativeInteger(
      body.planMonth1,
      "planMonth1",
    ),
    planMonth2: normalizeOptionalNonNegativeInteger(
      body.planMonth2,
      "planMonth2",
    ),
    planMonth3: normalizeOptionalNonNegativeInteger(
      body.planMonth3,
      "planMonth3",
    ),
    comment: normalizeOptionalComment(body.comment),
  };
}

function toLocationPotentialResponse(
  row: LocationPotentialRow,
): LocationPotentialResponse {
  return {
    id: row.id,
    locationId: row.locationId,
    productCategoryId: row.productCategoryId,
    productCategory: {
      id: row.productCategory.id,
      name: row.productCategory.name,
    },
    potentialDate: row.potentialDate
      ? row.potentialDate.toISOString().slice(0, 10)
      : null,
    potentialAmount: row.potentialAmount,
    planMonth1: row.planMonth1,
    planMonth2: row.planMonth2,
    planMonth3: row.planMonth3,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
