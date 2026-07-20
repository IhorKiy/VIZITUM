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
      totals,
      requiredCount,
      inStockCount,
      topProblemProductGroups,
      potentialByCategoryGroups,
    ] = await Promise.all([
      this.prisma.location.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.locationPotential.groupBy({
        by: ["locationId"],
        where: { tenantId },
        _sum: { potentialAmount: true },
      }),
      this.prisma.locationAssortment.groupBy({
        by: ["locationId"],
        where: { tenantId, shouldBeListed: true },
        _count: { _all: true },
      }),
      this.prisma.locationAssortment.groupBy({
        by: ["locationId"],
        where: { tenantId, shouldBeListed: true, status: "in_stock" },
        _count: { _all: true },
      }),
      this.prisma.locationPotential.aggregate({
        where: { tenantId },
        _sum: {
          potentialAmount: true,
          planMonth1: true,
          planMonth2: true,
          planMonth3: true,
        },
      }),
      this.prisma.locationAssortment.count({
        where: { tenantId, shouldBeListed: true },
      }),
      this.prisma.locationAssortment.count({
        where: { tenantId, shouldBeListed: true, status: "in_stock" },
      }),
      this.prisma.locationAssortment.groupBy({
        by: ["productId"],
        where: { tenantId, status: { in: ["out_of_stock", "to_order"] } },
        _count: { productId: true },
        orderBy: { _count: { productId: "desc" } },
        take: TOP_N,
      }),
      this.prisma.locationPotential.groupBy({
        by: ["productCategoryId"],
        where: { tenantId },
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

    const locationSummaries: LocationInsightsLocationSummary[] = locations.map(
      (location) => {
        const required = requiredByLocationId.get(location.id) ?? 0;
        const inStock = inStockByLocationId.get(location.id) ?? 0;

        return {
          locationId: location.id,
          name: location.name,
          totalPotential: potentialByLocationId.get(location.id) ?? 0,
          coveragePct: computeCoveragePct(required, inStock),
          requiredCount: required,
          inStockCount: inStock,
        };
      },
    );

    const highPotentialLowCoverage = locationSummaries
      .filter(
        (summary) =>
          summary.totalPotential > 0 &&
          summary.coveragePct < HIGH_POTENTIAL_LOW_COVERAGE_THRESHOLD,
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
      locations: locationSummaries,
      highPotentialLowCoverage,
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
      where: { id: { in: groups.map((group) => group.productId) }, tenantId },
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
