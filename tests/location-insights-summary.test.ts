import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeCoveragePct } from "../src/modules/location-insights/location-insights-parsing";
import { LocationInsightsSummaryService } from "../src/modules/location-insights/location-insights-summary.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: ["location_insights.read"],
};

describe("computeCoveragePct", () => {
  it("returns 0 when there are no required rows", () => {
    assert.equal(computeCoveragePct(0, 0), 0);
  });

  it("rounds down at the .49 boundary", () => {
    assert.equal(computeCoveragePct(3, 1), 33);
  });

  it("rounds up at the .5+ boundary", () => {
    assert.equal(computeCoveragePct(3, 2), 67);
  });

  it("caps at 100 when every required row is in stock", () => {
    assert.equal(computeCoveragePct(4, 4), 100);
  });
});

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  take?: number;
  orderBy?: unknown;
};

function buildScenarioPrisma() {
  const capturedTakes: Record<string, number | undefined> = {};
  const capturedOrderBys: Record<string, unknown> = {};

  const prisma = {
    location: {
      findMany: async (args: { where: unknown }) => {
        assert.deepEqual(args.where, { tenantId: "tenant-a", deletedAt: null });
        return [
          { id: "loc-1", name: "Store A" },
          { id: "loc-2", name: "Store B" },
          { id: "loc-3", name: "Store C" },
        ];
      },
    },
    locationPotential: {
      groupBy: async (args: GroupByArgs) => {
        // Both the locationId and productCategoryId groupBys must exclude
        // archived locations' rows — the where shape is identical for both.
        assert.deepEqual(args.where, {
          tenantId: "tenant-a",
          location: { deletedAt: null },
        });
        if (args.by[0] === "locationId") {
          return [
            { locationId: "loc-1", _sum: { potentialAmount: 1000 } },
            { locationId: "loc-2", _sum: { potentialAmount: 200 } },
          ];
        }
        capturedTakes.potentialByCategory = args.take;
        capturedOrderBys.potentialByCategory = args.orderBy;
        return [
          {
            productCategoryId: "category-a",
            _sum: {
              potentialAmount: 900,
              planMonth1: 90,
              planMonth2: 80,
              planMonth3: 70,
            },
          },
          {
            productCategoryId: "category-b",
            _sum: {
              potentialAmount: 300,
              planMonth1: 10,
              planMonth2: 20,
              planMonth3: 30,
            },
          },
        ];
      },
      aggregate: async (args: { where: unknown }) => {
        assert.deepEqual(args.where, {
          tenantId: "tenant-a",
          location: { deletedAt: null },
        });
        return {
          _sum: {
            potentialAmount: 1200,
            planMonth1: 100,
            planMonth2: 150,
            planMonth3: 200,
          },
        };
      },
    },
    locationAssortment: {
      groupBy: async (args: GroupByArgs) => {
        if (args.by[0] === "productId") {
          assert.deepEqual(args.where, {
            tenantId: "tenant-a",
            shouldBeListed: true,
            status: "out_of_stock",
            location: { deletedAt: null },
            product: { deletedAt: null },
          });
          capturedTakes.topProblemProducts = args.take;
          capturedOrderBys.topProblemProducts = args.orderBy;
          // product-c is soft-deleted — it must fall out once product.findMany
          // below applies its own deletedAt: null filter.
          return [
            { productId: "product-a", _count: { productId: 5 } },
            { productId: "product-b", _count: { productId: 3 } },
            { productId: "product-c", _count: { productId: 2 } },
          ];
        }
        if (args.where.status === "in_stock") {
          assert.deepEqual(args.where, {
            tenantId: "tenant-a",
            shouldBeListed: true,
            status: "in_stock",
            location: { deletedAt: null },
            product: { deletedAt: null },
          });
          return [
            { locationId: "loc-1", _count: { _all: 3 } },
            { locationId: "loc-2", _count: { _all: 4 } },
          ];
        }
        assert.deepEqual(args.where, {
          tenantId: "tenant-a",
          shouldBeListed: true,
          location: { deletedAt: null },
          product: { deletedAt: null },
        });
        return [
          { locationId: "loc-1", _count: { _all: 10 } },
          { locationId: "loc-2", _count: { _all: 4 } },
        ];
      },
      count: async (args: { where: Record<string, unknown> }) => {
        if (args.where.status === "in_stock") {
          assert.deepEqual(args.where, {
            tenantId: "tenant-a",
            shouldBeListed: true,
            status: "in_stock",
            location: { deletedAt: null },
            product: { deletedAt: null },
          });
          return 7;
        }
        assert.deepEqual(args.where, {
          tenantId: "tenant-a",
          shouldBeListed: true,
          location: { deletedAt: null },
          product: { deletedAt: null },
        });
        return 14;
      },
    },
    product: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        assert.deepEqual(args.where, {
          id: { in: ["product-a", "product-b", "product-c"] },
          tenantId: "tenant-a",
          deletedAt: null,
        });
        // Simulates the real query: product-c is soft-deleted so it's absent
        // from the result, which must make it fall out of topProblemProducts.
        return [
          { id: "product-a", name: "Widget A", sku: "SKU-A" },
          { id: "product-b", name: "Widget B", sku: "SKU-B" },
        ];
      },
    },
    productCategory: {
      findMany: async () => [
        { id: "category-a", name: "Bakery" },
        { id: "category-b", name: "Snacks" },
      ],
    },
  };

  return { prisma, capturedTakes, capturedOrderBys };
}

describe("LocationInsightsSummaryService", () => {
  it("aggregates tenant totals, per-location coverage, and top-N lists with grouped queries only", async () => {
    const { prisma, capturedTakes, capturedOrderBys } = buildScenarioPrisma();
    const service = new LocationInsightsSummaryService(prisma as never);

    const response = await service.getSummary(context as never);

    assert.equal(response.totalPotential, 1200);
    assert.equal(response.planMonth1, 100);
    assert.equal(response.planMonth2, 150);
    assert.equal(response.planMonth3, 200);
    assert.equal(response.requiredCount, 14);
    assert.equal(response.inStockCount, 7);
    assert.equal(response.overallCoveragePct, 50);

    assert.equal(response.locations.length, 3);
    const byId = new Map(response.locations.map((entry) => [entry.locationId, entry]));
    assert.deepEqual(byId.get("loc-1"), {
      locationId: "loc-1",
      name: "Store A",
      totalPotential: 1000,
      coveragePct: 30,
      requiredCount: 10,
      inStockCount: 3,
    });
    assert.deepEqual(byId.get("loc-2"), {
      locationId: "loc-2",
      name: "Store B",
      totalPotential: 200,
      coveragePct: 100,
      requiredCount: 4,
      inStockCount: 4,
    });
    // loc-3 has no potential or assortment rows at all — it still appears, at
    // 0 potential and 0% coverage, rather than being silently dropped.
    assert.deepEqual(byId.get("loc-3"), {
      locationId: "loc-3",
      name: "Store C",
      totalPotential: 0,
      coveragePct: 0,
      requiredCount: 0,
      inStockCount: 0,
    });

    // Only loc-1 has both potential > 0 and coverage < 70 — loc-2 has 100%
    // coverage and loc-3 has 0 potential, so neither qualifies.
    assert.deepEqual(response.highPotentialLowCoverage, [byId.get("loc-1")]);

    // product-c (soft-deleted) is correctly absent — see the product.findMany
    // mock above.
    assert.deepEqual(response.topProblemProducts, [
      { productId: "product-a", name: "Widget A", sku: "SKU-A", problemCount: 5 },
      { productId: "product-b", name: "Widget B", sku: "SKU-B", problemCount: 3 },
    ]);
    assert.equal(capturedTakes.topProblemProducts, 5);
    assert.deepEqual(capturedOrderBys.topProblemProducts, {
      _count: { productId: "desc" },
    });

    assert.deepEqual(response.potentialByCategory, [
      {
        productCategoryId: "category-a",
        name: "Bakery",
        totalPotential: 900,
        planMonth1: 90,
        planMonth2: 80,
        planMonth3: 70,
      },
      {
        productCategoryId: "category-b",
        name: "Snacks",
        totalPotential: 300,
        planMonth1: 10,
        planMonth2: 20,
        planMonth3: 30,
      },
    ]);
    assert.equal(capturedTakes.potentialByCategory, 5);
    assert.deepEqual(capturedOrderBys.potentialByCategory, {
      _sum: { potentialAmount: "desc" },
    });
  });

  it("returns all-zero totals and empty lists for a tenant with no data", async () => {
    const prisma = {
      location: {
        findMany: async () => [{ id: "loc-1", name: "Store A" }],
      },
      locationPotential: {
        groupBy: async () => [],
        aggregate: async () => ({
          _sum: {
            potentialAmount: null,
            planMonth1: null,
            planMonth2: null,
            planMonth3: null,
          },
        }),
      },
      locationAssortment: {
        groupBy: async () => [],
        count: async () => 0,
      },
      product: { findMany: async () => [] },
      productCategory: { findMany: async () => [] },
    };
    const service = new LocationInsightsSummaryService(prisma as never);

    const response = await service.getSummary(context as never);

    assert.equal(response.totalPotential, 0);
    assert.equal(response.overallCoveragePct, 0);
    assert.deepEqual(response.locations, [
      {
        locationId: "loc-1",
        name: "Store A",
        totalPotential: 0,
        coveragePct: 0,
        requiredCount: 0,
        inStockCount: 0,
      },
    ]);
    assert.deepEqual(response.highPotentialLowCoverage, []);
    assert.deepEqual(response.topProblemProducts, []);
    assert.deepEqual(response.potentialByCategory, []);
  });
});
