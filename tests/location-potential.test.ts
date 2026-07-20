import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationPotentialService } from "../src/modules/location-insights/location-potential.service";
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

const category = { id: "category-a", name: "Bakery" };

function buildPotentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "potential-a",
    locationId: "location-a",
    productCategoryId: "category-a",
    potentialDate: new Date("2026-07-01T00:00:00.000Z"),
    potentialAmount: 1000,
    planMonth1: 100,
    planMonth2: 200,
    planMonth3: 300,
    comment: "Strong seasonal demand.",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    productCategory: category,
    ...overrides,
  };
}

describe("LocationPotentialService tenant isolation", () => {
  it("404s a location that does not exist in the caller's tenant", async () => {
    let capturedWhere: unknown;
    const prisma = {
      location: {
        findFirst: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return null;
        },
      },
    };
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.listPotential(adminContext as never, "location-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_NOT_FOUND");
        return true;
      },
    );
    assert.deepEqual(capturedWhere, {
      id: "location-a",
      tenantId: "tenant-a",
      deletedAt: null,
    });
  });

  it("scopes the row list query by tenantId and locationId", async () => {
    let capturedWhere: unknown;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationPotential: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [buildPotentialRow()];
        },
      },
    };
    const service = new LocationPotentialService(prisma as never);

    const response = await service.listPotential(
      adminContext as never,
      "location-a",
    );

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      locationId: "location-a",
    });
    assert.equal(response.items.length, 1);
    assert.equal(response.items[0]?.productCategory.name, "Bakery");
    assert.equal(response.canManage, true);
  });
});

describe("LocationPotentialService ownership enforcement", () => {
  it("forbids an unassigned field representative from upserting", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssignment: { findFirst: async () => null },
    };
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(
        repContext as never,
        "location-a",
        "category-a",
        { potentialAmount: 500 },
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_INSIGHTS_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });

  it("allows an assigned field representative to upsert", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationAssignment: { findFirst: async () => ({ id: "assignment-a" }) },
      productCategory: { findFirst: async () => category },
      locationPotential: {
        upsert: async () => buildPotentialRow({ potentialAmount: 500 }),
      },
    };
    const service = new LocationPotentialService(prisma as never);

    const response = await service.upsertPotential(
      repContext as never,
      "location-a",
      "category-a",
      { potentialAmount: 500 },
    );

    assert.equal(response.potentialAmount, 500);
  });
});

describe("LocationPotentialService upsert idempotency", () => {
  it("upserts on the (tenant, location, category) compound key with identical create/update data", async () => {
    type UpsertArgs = {
      where: unknown;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    let capturedArgs: UpsertArgs | null = null;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      productCategory: { findFirst: async () => category },
      locationPotential: {
        upsert: async (args: UpsertArgs) => {
          capturedArgs = args;
          return buildPotentialRow();
        },
      },
    };
    const service = new LocationPotentialService(prisma as never);

    await service.upsertPotential(adminContext as never, "location-a", "category-a", {
      potentialAmount: 1000,
      planMonth1: 100,
      planMonth2: 200,
      planMonth3: 300,
      comment: "Strong seasonal demand.",
      potentialDate: "2026-07-01",
    });

    assert.ok(capturedArgs);
    const args = capturedArgs as UpsertArgs;

    assert.deepEqual(args.where, {
      tenantId_locationId_productCategoryId: {
        tenantId: "tenant-a",
        locationId: "location-a",
        productCategoryId: "category-a",
      },
    });
    assert.deepEqual(args.create, {
      tenantId: "tenant-a",
      locationId: "location-a",
      productCategoryId: "category-a",
      ...args.update,
    });
  });

  it("rejects a category that does not belong to the tenant", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      productCategory: { findFirst: async () => null },
    };
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(adminContext as never, "location-a", "category-x", {}),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "PRODUCT_CATEGORY_INVALID");
        return true;
      },
    );
  });
});

describe("LocationPotentialService validation", () => {
  const prisma = {
    location: { findFirst: async () => ({ id: "location-a" }) },
    productCategory: { findFirst: async () => category },
  };

  it("rejects a negative potentialAmount", async () => {
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(adminContext as never, "location-a", "category-a", {
        potentialAmount: -5,
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
  });

  it("rejects a potentialAmount above the int32 bound", async () => {
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(adminContext as never, "location-a", "category-a", {
        potentialAmount: 9999999999,
      }),
    );
  });

  it("rejects a comment longer than 500 characters", async () => {
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(adminContext as never, "location-a", "category-a", {
        comment: "x".repeat(501),
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
  });

  it("rejects a calendar-invalid potentialDate", async () => {
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.upsertPotential(adminContext as never, "location-a", "category-a", {
        potentialDate: "2026-02-31",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_INSIGHTS_VALUE_INVALID");
        return true;
      },
    );
  });
});

describe("LocationPotentialService delete", () => {
  it("404s deleting a row that does not exist", async () => {
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationPotential: { findFirst: async () => null },
    };
    const service = new LocationPotentialService(prisma as never);

    await assert.rejects(
      service.deletePotential(adminContext as never, "location-a", "category-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_POTENTIAL_NOT_FOUND");
        return true;
      },
    );
  });

  it("deletes an existing row", async () => {
    let deletedId: string | undefined;
    const prisma = {
      location: { findFirst: async () => ({ id: "location-a" }) },
      locationPotential: {
        findFirst: async () => ({ id: "potential-a" }),
        delete: async (query: { where: { id: string } }) => {
          deletedId = query.where.id;
          return {};
        },
      },
    };
    const service = new LocationPotentialService(prisma as never);

    const response = await service.deletePotential(
      adminContext as never,
      "location-a",
      "category-a",
    );

    assert.deepEqual(response, { deleted: true });
    assert.equal(deletedId, "potential-a");
  });
});
