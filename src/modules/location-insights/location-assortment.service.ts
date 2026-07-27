import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AssortmentStatus, ProductStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import {
  assertCanManageAssortment,
  canManageAssortment,
  findTenantLocationOrThrow,
} from "./location-insights-access";
import {
  computeCoveragePct,
  normalizeOptionalBoolean,
} from "./location-insights-parsing";
import type {
  ListLocationAssortmentResponse,
  LocationAssortmentResponse,
  UpsertLocationAssortmentRequestBody,
} from "./location-insights.types";

type LocationAssortmentRow = {
  id: string;
  locationId: string;
  productId: string;
  shouldBeListed: boolean;
  status: AssortmentStatus | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    status: ProductStatus;
  };
};

type LocationAssortmentData = {
  shouldBeListed: boolean;
};

const ASSORTMENT_INCLUDE = {
  product: {
    select: { id: true, name: true, sku: true, category: true, status: true },
  },
} as const;

@Injectable()
export class LocationAssortmentService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssortment(
    context: RequestContext,
    locationId: string,
  ): Promise<ListLocationAssortmentResponse> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);

    const canManage = canManageAssortment(context);
    const rows = await this.prisma.locationAssortment.findMany({
      where: {
        tenantId: context.tenantId,
        locationId,
        product: { deletedAt: null },
      },
      include: ASSORTMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });

    // Coverage is computed from this location's own rows, not a separate
    // query — the list is already the full, unpaginated set for one location.
    const requiredRows = rows.filter((row) => row.shouldBeListed);
    const requiredCount = requiredRows.length;
    const inStockCount = requiredRows.filter(
      (row) => row.status === "in_stock",
    ).length;

    return {
      items: rows.map(toLocationAssortmentResponse),
      canManage,
      coveragePct: computeCoveragePct(requiredCount, inStockCount),
      requiredCount,
      inStockCount,
    };
  }

  async upsertAssortment(
    context: RequestContext,
    locationId: string,
    productId: string,
    body: UpsertLocationAssortmentRequestBody,
  ): Promise<LocationAssortmentResponse> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);
    assertCanManageAssortment(context);
    await this.findTenantProduct(context.tenantId, productId);

    const data = parseUpsertAssortmentBody(body);

    // `update` carries only the matrix flag on purpose. A manager re-saving a
    // row must not touch `status`/`lastCheckedAt` — those belong to the last
    // visit that checked the shelf, and spreading a full row here would reset
    // them to their defaults on every edit. A created row starts with no
    // status at all: nobody has looked at the shelf yet.
    const row = await this.prisma.locationAssortment.upsert({
      where: {
        tenantId_locationId_productId: {
          tenantId: context.tenantId,
          locationId,
          productId,
        },
      },
      create: {
        tenantId: context.tenantId,
        locationId,
        productId,
        ...data,
      },
      update: data,
      include: ASSORTMENT_INCLUDE,
    });

    return toLocationAssortmentResponse(row);
  }

  async deleteAssortment(
    context: RequestContext,
    locationId: string,
    productId: string,
  ): Promise<{ deleted: true }> {
    await findTenantLocationOrThrow(this.prisma, context.tenantId, locationId);
    assertCanManageAssortment(context);

    const existing = await this.prisma.locationAssortment.findFirst({
      where: { tenantId: context.tenantId, locationId, productId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException({
        code: "LOCATION_ASSORTMENT_NOT_FOUND",
        message: "Location assortment row was not found.",
      });
    }

    await this.prisma.locationAssortment.delete({
      where: { id: existing.id },
    });

    return { deleted: true };
  }

  private async findTenantProduct(
    tenantId: string,
    productId: string,
  ): Promise<void> {
    // A product can be `status: archived` and still be a valid reference —
    // only an actually soft-deleted product (deletedAt set) is rejected. A
    // rep's existing rows also keep showing an archived product's join data
    // (see toLocationAssortmentResponse); this check only gates new writes.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new BadRequestException({
        code: "PRODUCT_REFERENCE_INVALID",
        message: "Product must belong to this tenant and not be archived.",
        fieldErrors: {
          productId: ["Must reference an active product in this tenant."],
        },
      });
    }
  }
}

function parseUpsertAssortmentBody(
  body: UpsertLocationAssortmentRequestBody,
): LocationAssortmentData {
  return {
    shouldBeListed: normalizeOptionalBoolean(
      body.shouldBeListed,
      "shouldBeListed",
      true,
    ),
  };
}

// Nests the joined product under `product` rather than spreading it flat —
// Product.status (active/inactive/archived) and this row's own `status`
// (in_stock/out_of_stock/null) would otherwise collide.
function toLocationAssortmentResponse(
  row: LocationAssortmentRow,
): LocationAssortmentResponse {
  return {
    id: row.id,
    locationId: row.locationId,
    productId: row.productId,
    product: {
      id: row.product.id,
      name: row.product.name,
      sku: row.product.sku,
      category: row.product.category,
      status: row.product.status,
    },
    shouldBeListed: row.shouldBeListed,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt
      ? row.lastCheckedAt.toISOString().slice(0, 10)
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
