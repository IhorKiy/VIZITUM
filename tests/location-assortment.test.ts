import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationAssortmentService } from "../src/modules/location-insights/location-assortment.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const managerContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: [
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    PERMISSIONS.LOCATION_ASSORTMENT_MANAGE,
  ],
};

// A representative reads the assortment (the shelf-check chips in the visit
// report are exactly this list) but never writes it — the potential is the one
// insights table they own.
const repContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN,
  ],
};

const product = {
  id: "product-a",
  name: "Widget",
  sku: "SKU-1",
  category: "Hardware",
  status: "active",
};

function buildAssortmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "assortment-a",
    locationId: "location-a",
    productId: "product-a",
    shouldBeListed: true,
    status: "in_stock",
    lastCheckedAt: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    product,
    ...overrides,
  };
}

describe("LocationAssortmentService tenant isolation", () => {
  it("404s a location that does not exist in the caller's tenant", async () => {
    const prisma = { location: { findFirst: async () => null } };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.listAssortment(managerContext as never, "location-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_NOT_FOUND");
        return true;
      },
    );
  });

  it("scopes the row list query by tenantId, locationId, and excludes soft-deleted products", async () => {
    let capturedWhere: unknown;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [buildAssortmentRow()];
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      locationId: "location-a",
      product: { deletedAt: null },
    });
    assert.equal(response.items.length, 1);
    assert.equal(response.canManage, true);
  });
});

describe("LocationAssortmentService soft-deleted product exclusion", () => {
  it("excludes rows whose product is soft-deleted from items and coverage", async () => {
    // Simulates the real query rather than mocking the filter away (same
    // pattern as tests/products-create.test.ts): only rows that pass the
    // `product: { deletedAt: null }` filter come back.
    const entries = [
      { row: buildAssortmentRow(), productDeleted: false },
      {
        row: buildAssortmentRow({
          id: "assortment-b",
          productId: "product-deleted",
          shouldBeListed: true,
          status: "out_of_stock",
          product: {
            ...product,
            id: "product-deleted",
            name: "Discontinued Widget",
          },
        }),
        productDeleted: true,
      },
    ];
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async (query: {
          where: { product?: { deletedAt: null } };
        }) => {
          const excludesSoftDeleted = query.where.product?.deletedAt === null;

          return entries
            .filter((entry) => !excludesSoftDeleted || !entry.productDeleted)
            .map((entry) => entry.row);
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0]?.productId, "product-a");
    assert.equal(response.requiredCount, 1);
    assert.equal(response.inStockCount, 1);
    assert.equal(response.coveragePct, 100);
  });
});

describe("LocationAssortmentService response shape", () => {
  it("nests the joined product instead of flattening it, avoiding a status collision", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({
            status: "out_of_stock",
            product: { ...product, status: "archived" },
          }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    const [item] = response.items;
    assert.equal(item?.status, "out_of_stock");
    assert.equal(item?.product.status, "archived");
    assert.equal(item?.product.name, "Widget");
  });
});

describe("LocationAssortmentService coverage math", () => {
  it("computes coveragePct from this location's required rows", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({
            productId: "product-a",
            shouldBeListed: true,
            status: "in_stock",
          }),
          buildAssortmentRow({
            productId: "product-b",
            shouldBeListed: true,
            status: "out_of_stock",
          }),
          buildAssortmentRow({
            productId: "product-c",
            shouldBeListed: false,
            status: "in_stock",
          }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.requiredCount, 2);
    assert.equal(response.inStockCount, 1);
    assert.equal(response.coveragePct, 50);
  });

  // The whole point of a null status: a matrix the manager has just typed in
  // must not read as covered before anyone has checked a shelf.
  it("counts a never-confirmed row as required but not in stock", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({
            productId: "product-a",
            shouldBeListed: true,
            status: null,
            lastCheckedAt: null,
          }),
          buildAssortmentRow({
            productId: "product-b",
            shouldBeListed: true,
            status: "in_stock",
          }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.items[0]?.status, null);
    assert.equal(response.requiredCount, 2);
    assert.equal(response.inStockCount, 1);
    assert.equal(response.coveragePct, 50);
    assert.equal(response.checkedCount, 1);
  });

  // 0% because nobody has visited and 0% because the shelf was bare are the
  // same percentage and opposite problems; `checkedCount` is what lets a
  // caller tell them apart instead of reporting an unearned verdict.
  it("reports zero checked rows for a matrix no visit has confirmed", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({
            productId: "product-a",
            status: null,
            lastCheckedAt: null,
          }),
          buildAssortmentRow({
            productId: "product-b",
            status: null,
            lastCheckedAt: null,
          }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.requiredCount, 2);
    assert.equal(response.checkedCount, 0);
    assert.equal(response.coveragePct, 0);
  });

  it("counts an out-of-stock row as checked, not as missing information", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({
            productId: "product-a",
            status: "out_of_stock",
          }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.checkedCount, 1);
    assert.equal(response.inStockCount, 0);
    assert.equal(response.coveragePct, 0);
  });

  it("returns 0 coverage when there are no required rows", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({ shouldBeListed: false, status: null }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.requiredCount, 0);
    assert.equal(response.coveragePct, 0);
  });
});

describe("LocationAssortmentService write scope", () => {
  it("forbids a field representative from upserting even where they are assigned", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      // An active assignment is deliberately present: it buys potential
      // access, never assortment access.
      locationAssignment: {
        findFirst: async () => ({ id: "assignment-a" }),
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(repContext as never, "location-a", "product-a", {
        status: "in_stock",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_ASSORTMENT_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });

  it("forbids a field representative from deleting a row", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssignment: {
        findFirst: async () => ({ id: "assignment-a" }),
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.deleteAssortment(repContext as never, "location-a", "product-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_ASSORTMENT_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });

  it("reports canManage false to a representative reading the list", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: { findMany: async () => [buildAssortmentRow()] },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      repContext as never,
      "location-a",
    );

    assert.equal(response.canManage, false);
    assert.equal(response.items.length, 1);
  });

  it("reports canManage true to a manager without querying assignments", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: { findMany: async () => [buildAssortmentRow()] },
      // No locationAssignment stub: a tenant-wide standard must not depend on
      // one, and this would throw if the check regained an ownership query.
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      managerContext as never,
      "location-a",
    );

    assert.equal(response.canManage, true);
  });
});

describe("LocationAssortmentService upsert scope", () => {
  // The manager owns the matrix; the shelf state belongs to the last visit
  // that checked it. If an edit here wrote the full row, re-saving the matrix
  // flag would silently reset a rep's observation and inflate coverage.
  it("writes only the matrix flag, leaving field-owned shelf state untouched", async () => {
    let capturedUpdate: Record<string, unknown> | null = null;
    let capturedCreate: Record<string, unknown> | null = null;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      product: { findFirst: async () => product },
      locationAssortment: {
        upsert: async (args: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          capturedUpdate = args.update;
          capturedCreate = args.create;
          return buildAssortmentRow();
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    await service.upsertAssortment(
      managerContext as never,
      "location-a",
      "product-a",
      { shouldBeListed: false },
    );

    assert.deepEqual(capturedUpdate, { shouldBeListed: false });
    // A brand-new row carries no status: nobody has looked at the shelf yet.
    assert.deepEqual(capturedCreate, {
      tenantId: "tenant-a",
      locationId: "location-a",
      productId: "product-a",
      shouldBeListed: false,
    });
  });

  // A body that still carries the removed observation fields (an old client,
  // or a hand-rolled request) must not smuggle them into the write.
  it("ignores shelf-state fields supplied in the request body", async () => {
    let capturedUpdate: Record<string, unknown> | null = null;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      product: { findFirst: async () => product },
      locationAssortment: {
        upsert: async (args: { update: Record<string, unknown> }) => {
          capturedUpdate = args.update;
          return buildAssortmentRow();
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    await service.upsertAssortment(
      managerContext as never,
      "location-a",
      "product-a",
      {
        shouldBeListed: true,
        status: "in_stock",
        lastCheckedAt: "2026-07-20",
        lastStock: 12,
      } as never,
    );

    assert.deepEqual(capturedUpdate, { shouldBeListed: true });
  });

  it("upserts on the (tenant, location, product) compound key with identical create/update data", async () => {
    type UpsertArgs = {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    let capturedArgs: UpsertArgs | null = null;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      product: { findFirst: async () => product },
      locationAssortment: {
        upsert: async (args: UpsertArgs) => {
          capturedArgs = args;
          return buildAssortmentRow();
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    await service.upsertAssortment(
      managerContext as never,
      "location-a",
      "product-a",
      { shouldBeListed: true },
    );

    assert.ok(capturedArgs);
    const args = capturedArgs as UpsertArgs;

    assert.deepEqual(args.where, {
      tenantId_locationId_productId: {
        tenantId: "tenant-a",
        locationId: "location-a",
        productId: "product-a",
      },
    });
    assert.deepEqual(args.create, {
      tenantId: "tenant-a",
      locationId: "location-a",
      productId: "product-a",
      ...args.update,
    });
  });

  it("rejects a product that does not belong to the tenant (or is soft-deleted)", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      product: { findFirst: async () => null },
    };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(
        managerContext as never,
        "location-a",
        "product-x",
        {},
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "PRODUCT_REFERENCE_INVALID");
        return true;
      },
    );
  });
});

describe("LocationAssortmentService validation", () => {
  const prisma = {
    location: { findFirst: async () => ({ id: "location-a" }) },
    product: { findFirst: async () => product },
  };

  // shouldBeListed is the only value this endpoint still accepts, so it is the
  // only one left to validate.
  it("rejects a non-boolean shouldBeListed", async () => {
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(
        managerContext as never,
        "location-a",
        "product-a",
        {
          shouldBeListed: "yes",
        },
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_INSIGHTS_VALUE_INVALID",
        );
        return true;
      },
    );
  });

  it("defaults an omitted shouldBeListed to required", async () => {
    let capturedUpdate: Record<string, unknown> | null = null;
    const service = new LocationAssortmentService({
      ...prisma,
      locationAssortment: {
        upsert: async (args: { update: Record<string, unknown> }) => {
          capturedUpdate = args.update;
          return buildAssortmentRow();
        },
      },
    } as never);

    await service.upsertAssortment(
      managerContext as never,
      "location-a",
      "product-a",
      {},
    );

    assert.deepEqual(capturedUpdate, { shouldBeListed: true });
  });
});

describe("LocationAssortmentService delete", () => {
  it("404s deleting a row that does not exist", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: { findFirst: async () => null },
    };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.deleteAssortment(
        managerContext as never,
        "location-a",
        "product-a",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_ASSORTMENT_NOT_FOUND",
        );
        return true;
      },
    );
  });

  it("deletes an existing row", async () => {
    let deletedId: string | undefined;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findFirst: async () => ({ id: "assortment-a" }),
        delete: async (query: { where: { id: string } }) => {
          deletedId = query.where.id;
          return {};
        },
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.deleteAssortment(
      managerContext as never,
      "location-a",
      "product-a",
    );

    assert.deepEqual(response, { deleted: true });
    assert.equal(deletedId, "assortment-a");
  });
});
