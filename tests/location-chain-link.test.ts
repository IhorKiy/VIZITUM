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
    externalCode: null,
    name: "Kyiv North Market",
    type: null,
    status: "active",
    addressLine: "Demo Avenue 10",
    city: "Kyiv",
    region: null,
    territory: null,
    latitude: null,
    longitude: null,
    notes: null,
    chain: null,
    // Reads load contacts and active assignments via LOCATION_INCLUDE, so the
    // mocked row carries them (empty here) the way Prisma would.
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
  chainId: "chain-a",
};

describe("location chain link", () => {
  it("rejects linking a location to a chain that the tenant does not own", async () => {
    let chainLookupWhere: Record<string, unknown> | undefined;
    const service = new LocationsService({
      chain: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          chainLookupWhere = where;
          return null;
        },
      },
      location: {
        create: async () => {
          throw new Error("create should not run when the chain is invalid");
        },
      },
    } as never);

    await assert.rejects(
      () => service.createLocation(context as never, validBody),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "LOCATION_CHAIN_INVALID",
    );

    // The chain must be resolved within the caller's tenant — a chainId from
    // another tenant must never satisfy the lookup.
    assert.equal(chainLookupWhere?.id, "chain-a");
    assert.equal(chainLookupWhere?.tenantId, "tenant-a");
    assert.equal(chainLookupWhere?.deletedAt, null);
  });

  it("stores a valid chain link and returns the chain summary", async () => {
    let createdData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      chain: {
        findFirst: async () => ({ id: "chain-a" }),
      },
      location: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdData = data;
          return locationRow({
            chainId: "chain-a",
            chain: { id: "chain-a", name: "ATB" },
          });
        },
      },
    } as never);

    const location = await service.createLocation(
      context as never,
      validBody,
    );

    assert.equal(createdData?.chainId, "chain-a");
    assert.equal(location.chainId, "chain-a");
    assert.deepEqual(location.chain, { id: "chain-a", name: "ATB" });
  });
});
