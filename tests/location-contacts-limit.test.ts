import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationsService } from "../src/modules/locations/locations.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [PERMISSIONS.CONTACTS_MANAGE],
};

function locationRow() {
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
    deletedAt: null,
  };
}

function contactRow() {
  return {
    id: "contact-new",
    locationId: "location-a",
    name: "New Person",
    roleTitle: null,
    phone: null,
    email: null,
    notes: null,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  };
}

describe("location contact limit", () => {
  it("rejects a third contact with 409 LOCATION_CONTACT_LIMIT_REACHED and does not create", async () => {
    let createCalled = false;
    const service = new LocationsService({
      location: { findFirst: async () => locationRow() },
      locationContact: {
        count: async () => 2,
        create: async () => {
          createCalled = true;
          return contactRow();
        },
      },
    } as never);

    await assert.rejects(
      service.createContact(context as never, "location-a", { name: "Third" }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_CONTACT_LIMIT_REACHED",
        );
        return true;
      },
    );
    assert.equal(createCalled, false);
  });

  it("creates the contact when the location is below the limit", async () => {
    let createArgs: { data: Record<string, unknown> } | undefined;
    const service = new LocationsService({
      location: { findFirst: async () => locationRow() },
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
      locationContact: {
        count: async () => 1,
        create: async (args: { data: Record<string, unknown> }) => {
          createArgs = args;
          return contactRow();
        },
      },
    } as never);

    const result = await service.createContact(
      context as never,
      "location-a",
      { name: "Second" },
    );

    assert.equal(result.id, "contact-new");
    assert.equal(createArgs?.data.name, "Second");
  });
});
