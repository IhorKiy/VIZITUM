import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import { computeCoveragePct } from "./location-insights-parsing";
import type {
  LocationInsightsCategoryPotential,
  LocationInsightsLocationSummary,
  LocationInsightsProblemProduct,
  LocationInsightsSummaryResponse,
} from "./location-insights.types";

const HIGH_POTENTIAL_LOW_COVERAGE_THRESHOLD = 70;
const TOP_N = 5;

@Injectable()
export class LocationInsightsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    context: RequestContext,
  ): Promise<LocationInsightsSummaryResponse> {
    const tenantId = context.tenantId;

    // Every query here is grouped/aggregated — none loads every potential or
    // assortment row into memory. Locations come from a plain findMany so
    // that zero-data locations still appear in the per-location list at 0%.
    const [
      locations,
      potentialByLocation,
      requiredByLocation,
      inStockByLocation,
      checkedByLocation,
      totals,
      requiredCount,
      inStockCount,
      checkedCount,
      topProblemProductGroups,
      potentialByCategoryGroups,
    ] = await Promise.all([
      this.prisma.location.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.locationPotential.groupBy({
        by: ["locationId"],
        where: { tenantId, location: { deletedAt: null } },
        _sum: { potentialAmount: true },
      }),
      this.prisma.locationAssortment.groupBy({
        by: ["locationId"],
        where: {
          tenantId,
          shouldBeListed: true,
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
        _count: { _all: true },
      }),
      this.prisma.locationAssortment.groupBy({
        by: ["locationId"],
        where: {
          tenantId,
          shouldBeListed: true,
          status: "in_stock",
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
        _count: { _all: true },
      }),
      // Confirmed rows and the freshest confirmation, in one pass: the count
      // separates "nobody has visited" from "the shelf was empty", the date
      // says how old the number next to it is.
      this.prisma.locationAssortment.groupBy({
        by: ["locationId"],
        where: {
          tenantId,
          shouldBeListed: true,
          status: { not: null },
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
        _count: { _all: true },
        _max: { lastCheckedAt: true },
      }),
      this.prisma.locationPotential.aggregate({
        where: { tenantId, location: { deletedAt: null } },
        _sum: {
          potentialAmount: true,
          planMonth1: true,
          planMonth2: true,
          planMonth3: true,
        },
      }),
      this.prisma.locationAssortment.count({
        where: {
          tenantId,
          shouldBeListed: true,
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
      }),
      this.prisma.locationAssortment.count({
        where: {
          tenantId,
          shouldBeListed: true,
          status: "in_stock",
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
      }),
      this.prisma.locationAssortment.count({
        where: {
          tenantId,
          shouldBeListed: true,
          status: { not: null },
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
      }),
      // Matches the coverage queries above on `shouldBeListed`: a product
      // missing from a shelf it was never required to be on is not a problem,
      // and counting it here contradicted every other number on the dashboard.
      this.prisma.locationAssortment.groupBy({
        by: ["productId"],
        where: {
          tenantId,
          shouldBeListed: true,
          status: "out_of_stock",
          location: { deletedAt: null },
          product: { deletedAt: null },
        },
        _count: { productId: true },
        orderBy: { _count: { productId: "desc" } },
        take: TOP_N,
      }),
      this.prisma.locationPotential.groupBy({
        by: ["productCategoryId"],
        where: { tenantId, location: { deletedAt: null } },
        _sum: {
          potentialAmount: true,
          planMonth1: true,
          planMonth2: true,
          planMonth3: true,
        },
        orderBy: { _sum: { potentialAmount: "desc" } },
        take: TOP_N,
      }),
    ]);

    const potentialByLocationId = new Map(
      potentialByLocation.map((row) => [
        row.locationId,
        row._sum.potentialAmount ?? 0,
      ]),
    );
    const requiredByLocationId = new Map(
      requiredByLocation.map((row) => [row.locationId, row._count._all]),
    );
    const inStockByLocationId = new Map(
      inStockByLocation.map((row) => [row.locationId, row._count._all]),
    );
    const checkedByLocationId = new Map(
      checkedByLocation.map((row) => [
        row.locationId,
        { count: row._count._all, lastCheckedAt: row._max.lastCheckedAt },
      ]),
    );

    const locationSummaries: LocationInsightsLocationSummary[] = locations.map(
      (location) => {
        const required = requiredByLocationId.get(location.id) ?? 0;
        const inStock = inStockByLocationId.get(location.id) ?? 0;
        const checked = checkedByLocationId.get(location.id);

        return {
          locationId: location.id,
          name: location.name,
          totalPotential: potentialByLocationId.get(location.id) ?? 0,
          coveragePct: computeCoveragePct(required, inStock),
          requiredCount: required,
          inStockCount: inStock,
          checkedCount: checked?.count ?? 0,
          lastCheckedAt: checked?.lastCheckedAt
            ? checked.lastCheckedAt.toISOString().slice(0, 10)
            : null,
        };
      },
    );

    // A location with a matrix nobody has checked reports 0% for want of a
    // visit, not for want of stock. Sending a manager to fix its assortment
    // would be acting on a number that means nothing yet, so it is filtered
    // out here and surfaced as its own list below.
    const highPotentialLowCoverage = locationSummaries
      .filter(
        (summary) =>
          summary.totalPotential > 0 &&
          summary.checkedCount > 0 &&
          summary.coveragePct < HIGH_POTENTIAL_LOW_COVERAGE_THRESHOLD,
      )
      .sort((a, b) => b.totalPotential - a.totalPotential)
      .slice(0, TOP_N);

    // Deliberately not gated on `totalPotential` the way the low-coverage list
    // is: the potential is rep-authored and plenty of tenants never fill it,
    // so requiring it would hide exactly the outlets nobody has visited —
    // including, in a tenant with no potential recorded at all, every single
    // one of them. Sorting by potential still floats the valuable ones first.
    const neverChecked = locationSummaries
      .filter(
        (summary) => summary.requiredCount > 0 && summary.checkedCount === 0,
      )
      .sort((a, b) => b.totalPotential - a.totalPotential)
      .slice(0, TOP_N);

    const [topProblemProducts, potentialByCategory] = await Promise.all([
      this.resolveTopProblemProducts(tenantId, topProblemProductGroups),
      this.resolvePotentialByCategory(tenantId, potentialByCategoryGroups),
    ]);

    return {
      totalPotential: totals._sum.potentialAmount ?? 0,
      planMonth1: totals._sum.planMonth1 ?? 0,
      planMonth2: totals._sum.planMonth2 ?? 0,
      planMonth3: totals._sum.planMonth3 ?? 0,
      overallCoveragePct: computeCoveragePct(requiredCount, inStockCount),
      requiredCount,
      inStockCount,
      checkedCount,
      locations: locationSummaries,
      highPotentialLowCoverage,
      neverChecked,
      topProblemProducts,
      potentialByCategory,
    };
  }

  private async resolveTopProblemProducts(
    tenantId: string,
    groups: { productId: string; _count: { productId: number } }[],
  ): Promise<LocationInsightsProblemProduct[]> {
    if (groups.length === 0) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: groups.map((group) => group.productId) },
        tenantId,
        deletedAt: null,
      },
      select: { id: true, name: true, sku: true },
    });
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    return groups
      .map((group) => {
        const product = productById.get(group.productId);

        return product
          ? {
              productId: group.productId,
              name: product.name,
              sku: product.sku,
              problemCount: group._count.productId,
            }
          : null;
      })
      .filter(
        (entry): entry is LocationInsightsProblemProduct => entry !== null,
      );
  }

  private async resolvePotentialByCategory(
    tenantId: string,
    groups: {
      productCategoryId: string;
      _sum: {
        potentialAmount: number | null;
        planMonth1: number | null;
        planMonth2: number | null;
        planMonth3: number | null;
      };
    }[],
  ): Promise<LocationInsightsCategoryPotential[]> {
    if (groups.length === 0) {
      return [];
    }

    const categories = await this.prisma.productCategory.findMany({
      where: {
        id: { in: groups.map((group) => group.productCategoryId) },
        tenantId,
      },
      select: { id: true, name: true },
    });
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );

    return groups
      .map((group) => {
        const category = categoryById.get(group.productCategoryId);

        return category
          ? {
              productCategoryId: group.productCategoryId,
              name: category.name,
              totalPotential: group._sum.potentialAmount ?? 0,
              planMonth1: group._sum.planMonth1 ?? 0,
              planMonth2: group._sum.planMonth2 ?? 0,
              planMonth3: group._sum.planMonth3 ?? 0,
            }
          : null;
      })
      .filter(
        (entry): entry is LocationInsightsCategoryPotential => entry !== null,
      );
  }
}
