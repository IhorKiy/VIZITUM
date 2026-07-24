import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { LocationsService } from "../src/modules/locations/locations.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

// Location contact create/update parses the optional phone against the
// tenant's phoneCountry and stores E.164. An unchanged phone on update is
// passed through without validation so contacts with legacy un-normalized
// phones stay editable.

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
    name: "Kyiv North Market",
    deletedAt: null,
  };
}

function contactRow(phone: string | null = null) {
  return {
    id: "contact-a",
    tenantId: "tenant-a",
    locationId: "location-a",
    name: "Existing Person",
    roleTitle: null,
    phone,
    email: null,
    notes: null,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    deletedAt: null,
  };
}

function createService(options: {
  phoneCountry: string | null;
  existingPhone?: string | null;
  onCreate?: (data: Record<string, unknown>) => void;
  onUpdate?: (data: Record<string, unknown>) => void;
}) {
  return new LocationsService({
    location: { findFirst: async () => locationRow() },
    platformTenant: {
      findUniqueOrThrow: async () => ({ phoneCountry: options.phoneCountry }),
    },
    locationContact: {
      count: async () => 0,
      findFirst: async () => contactRow(options.existingPhone ?? null),
      create: async (query: { data: Record<string, unknown> }) => {
        options.onCreate?.(query.data);
        return { ...contactRow(), ...query.data };
      },
      update: async (query: { data: Record<string, unknown> }) => {
        options.onUpdate?.(query.data);
        return { ...contactRow(), ...query.data };
      },
    },
  } as never);
}

describe("location contact phone normalization", () => {
  it("stores a national phone as E.164 on create", async () => {
    let created: Record<string, unknown> | undefined;
    const service = createService({
      phoneCountry: "UA",
      onCreate: (data) => (created = data),
    });

    await service.createContact(context as never, "location-a", {
      name: "New Person",
      phone: "067 123 45 67",
    });

    assert.equal(created?.phone, "+380671234567");
  });

  it("rejects an invalid phone on create with a phone field error", async () => {
    const service = createService({ phoneCountry: "UA" });

    await assert.rejects(
      () =>
        service.createContact(context as never, "location-a", {
          name: "New Person",
          phone: "not a phone",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "LOCATION_CONTACT_INVALID");
        assert.ok(response.fieldErrors.phone);
        return true;
      },
    );
  });

  it("rejects a national phone on create when the tenant has no phone country", async () => {
    const service = createService({ phoneCountry: null });

    await assert.rejects(
      () =>
        service.createContact(context as never, "location-a", {
          name: "New Person",
          phone: "067 123 45 67",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        return true;
      },
    );
  });

  it("stores a changed phone as E.164 on update", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      phoneCountry: "UA",
      existingPhone: "+380501112233",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      phone: "+49 30 901820",
    });

    assert.equal(updated?.phone, "+4930901820");
  });

  it("passes an unchanged legacy phone through without re-validation", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      phoneCountry: "UA",
      existingPhone: "044-123 (legacy)",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      name: "Renamed Person",
      phone: "044-123 (legacy)",
    });

    assert.equal(updated?.name, "Renamed Person");
    // The phone key is dropped from the update entirely — stored value stays.
    assert.equal("phone" in (updated ?? {}), false);
  });

  it("clears the phone when an empty value is submitted", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      phoneCountry: "UA",
      existingPhone: "+380501112233",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      phone: "",
    });

    assert.equal(updated?.phone, null);
  });
});
