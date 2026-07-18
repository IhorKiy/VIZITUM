import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationsService } from "../src/modules/locations/locations.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

function locationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "location-a",
    tenantId: "tenant-a",
    chainId: null,
    categoryId: null,
    externalCode: null,
    name: "Kyiv North Market",
    status: "active",
    addressLine: "Demo Avenue 10",
    city: "Kyiv",
    region: null,
    territory: null,
    latitude: null,
    longitude: null,
    notes: null,
    chain: null,
    category: null,
    contacts: [],
    assignments: [],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

const validBody = {
  name: "Kyiv North Market",
  addressLine: "Demo Avenue 10",
  city: "Kyiv",
  categoryId: "cat-a",
};

describe("location category link", () => {
  it("rejects linking a location to a category that the tenant does not own", async () => {
    let categoryLookupWhere: Record<string, unknown> | undefined;
    const service = new LocationsService({
      locationCategory: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          categoryLookupWhere = where;
          return null;
        },
      },
      location: {
        create: async () => {
          throw new Error("create should not run when the category is invalid");
        },
      },
    } as never);

    await assert.rejects(
      () => service.createLocation(context as never, validBody),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "LOCATION_CATEGORY_INVALID",
    );

    // The category must be resolved within the caller's tenant — a categoryId
    // from another tenant must never satisfy the lookup.
    assert.equal(categoryLookupWhere?.id, "cat-a");
    assert.equal(categoryLookupWhere?.tenantId, "tenant-a");
  });

  it("stores a valid category link and returns the category summary", async () => {
    let createdData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      locationCategory: {
        findFirst: async () => ({ id: "cat-a" }),
      },
      location: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return locationRow({
            categoryId: "cat-a",
            category: { id: "cat-a", name: "Bakery" },
          });
        },
      },
    } as never);

    const location = await service.createLocation(
      context as never,
      validBody,
    );

    assert.equal(createdData?.categoryId, "cat-a");
    assert.equal(location.categoryId, "cat-a");
    assert.deepEqual(location.category, { id: "cat-a", name: "Bakery" });
  });

  it("allows clearing the category on update", async () => {
    let updateData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow({ categoryId: "cat-a" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return locationRow({ categoryId: null, category: null });
        },
      },
    } as never);

    const location = await service.updateLocation(
      context as never,
      "location-a",
      { categoryId: null },
    );

    assert.equal(updateData?.categoryId, null);
    assert.equal(location.categoryId, null);
    assert.equal(location.category, null);
  });

  it("rejects updating to a category from another tenant", async () => {
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow(),
      },
      locationCategory: {
        findFirst: async () => null,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateLocation(context as never, "location-a", {
          categoryId: "cat-from-tenant-b",
        }),
      (error: { response?: { code?: string; fieldErrors?: unknown } }) =>
        error.response?.code === "LOCATION_CATEGORY_INVALID" &&
        Boolean(
          (error.response?.fieldErrors as { categoryId?: string[] } | undefined)
            ?.categoryId,
        ),
    );
  });
});
