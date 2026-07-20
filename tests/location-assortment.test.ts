import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationAssortmentService } from "../src/modules/location-insights/location-assortment.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const adminContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "admin-a",
  roleCodes: ["company_admin"],
  permissions: [
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE,
  ],
};

const repContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    PERMISSIONS.LOCATION_INSIGHTS_MANAGE_OWN,
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
    lastStock: 10,
    lastOrder: 5,
    lastSale: 3,
    lastCheckedAt: new Date("2026-07-01T00:00:00.000Z"),
    comment: "Checked during visit.",
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
      service.listAssortment(adminContext as never, "location-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_NOT_FOUND");
        return true;
      },
    );
  });

  it("scopes the row list query by tenantId and locationId", async () => {
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
      adminContext as never,
      "location-a",
    );

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      locationId: "location-a",
    });
    assert.equal(response.items.length, 1);
    assert.equal(response.canManage, true);
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
      adminContext as never,
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
          buildAssortmentRow({ productId: "product-a", shouldBeListed: true, status: "in_stock" }),
          buildAssortmentRow({ productId: "product-b", shouldBeListed: true, status: "out_of_stock" }),
          buildAssortmentRow({ productId: "product-c", shouldBeListed: false, status: "in_stock" }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      adminContext as never,
      "location-a",
    );

    assert.equal(response.requiredCount, 2);
    assert.equal(response.inStockCount, 1);
    assert.equal(response.coveragePct, 50);
  });

  it("returns 0 coverage when there are no required rows", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssortment: {
        findMany: async () => [
          buildAssortmentRow({ shouldBeListed: false, status: "not_relevant" }),
        ],
      },
    };
    const service = new LocationAssortmentService(prisma as never);

    const response = await service.listAssortment(
      adminContext as never,
      "location-a",
    );

    assert.equal(response.requiredCount, 0);
    assert.equal(response.coveragePct, 0);
  });
});

describe("LocationAssortmentService ownership enforcement", () => {
  it("forbids an unassigned field representative from upserting", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssignment: { findFirst: async () => null },
    };
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(repContext as never, "location-a", "product-a", {
        status: "in_stock",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_INSIGHTS_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });
});

describe("LocationAssortmentService upsert idempotency", () => {
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

    await service.upsertAssortment(adminContext as never, "location-a", "product-a", {
      shouldBeListed: true,
      status: "to_order",
      lastStock: 0,
    });

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
      service.upsertAssortment(adminContext as never, "location-a", "product-x", {}),
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

  it("rejects a negative lastStock", async () => {
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(adminContext as never, "location-a", "product-a", {
        lastStock: -1,
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
  });

  it("rejects an unknown status value", async () => {
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(adminContext as never, "location-a", "product-a", {
        status: "on_backorder",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
  });

  it("rejects a malformed lastCheckedAt date", async () => {
    const service = new LocationAssortmentService(prisma as never);

    await assert.rejects(
      service.upsertAssortment(adminContext as never, "location-a", "product-a", {
        lastCheckedAt: "not-a-date",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
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
      service.deleteAssortment(adminContext as never, "location-a", "product-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_ASSORTMENT_NOT_FOUND");
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
      adminContext as never,
      "location-a",
      "product-a",
    );

    assert.deepEqual(response, { deleted: true });
    assert.equal(deletedId, "assortment-a");
  });
});
