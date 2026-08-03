import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { LocationsService } from "../src/modules/locations/locations.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

// Item 3.8(c) of the security remediation plan: location contact create/update
// used to normalize the email field (trim, length cap) without checking its
// format at all. Format is now checked with the same shared isValidEmail as
// the rest of the backend, and — mirroring the phone field right next to it —
// an unchanged email on update is passed through without re-validation so a
// contact with a legacy, pre-validation email stays editable.

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

function contactRow(email: string | null = null) {
  return {
    id: "contact-a",
    tenantId: "tenant-a",
    locationId: "location-a",
    name: "Existing Person",
    roleTitle: null,
    phone: null,
    email,
    notes: null,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    deletedAt: null,
  };
}

function createService(options: {
  existingEmail?: string | null;
  onCreate?: (data: Record<string, unknown>) => void;
  onUpdate?: (data: Record<string, unknown>) => void;
}) {
  return new LocationsService({
    location: { findFirst: async () => locationRow() },
    platformTenant: {
      findUniqueOrThrow: async () => ({ phoneCountry: null }),
    },
    locationContact: {
      count: async () => 0,
      findFirst: async () => contactRow(options.existingEmail ?? null),
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

describe("location contact email validation", () => {
  it("stores a valid email on create", async () => {
    let created: Record<string, unknown> | undefined;
    const service = createService({ onCreate: (data) => (created = data) });

    await service.createContact(context as never, "location-a", {
      name: "New Person",
      email: "person@example.com",
    });

    assert.equal(created?.email, "person@example.com");
  });

  it("rejects an invalid email on create with an email field error", async () => {
    const service = createService({});

    await assert.rejects(
      () =>
        service.createContact(context as never, "location-a", {
          name: "New Person",
          email: "not-an-email",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "LOCATION_CONTACT_INVALID");
        assert.ok(response.fieldErrors.email);
        return true;
      },
    );
  });

  it("stores a changed email as-is on update", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      existingEmail: "old@example.com",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      email: "new@example.com",
    });

    assert.equal(updated?.email, "new@example.com");
  });

  it("rejects an invalid email on update with an email field error", async () => {
    const service = createService({ existingEmail: "old@example.com" });

    await assert.rejects(
      () =>
        service.updateContact(context as never, "location-a", "contact-a", {
          email: "not-an-email",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "LOCATION_CONTACT_INVALID");
        assert.ok(response.fieldErrors.email);
        return true;
      },
    );
  });

  it("passes an unchanged legacy email through without re-validation", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      existingEmail: "not-an-email (legacy)",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      name: "Renamed Person",
      email: "not-an-email (legacy)",
    });

    assert.equal(updated?.name, "Renamed Person");
    // The email key is dropped from the update entirely — stored value stays.
    assert.equal("email" in (updated ?? {}), false);
  });

  it("clears the email when an empty value is submitted", async () => {
    let updated: Record<string, unknown> | undefined;
    const service = createService({
      existingEmail: "old@example.com",
      onUpdate: (data) => (updated = data),
    });

    await service.updateContact(context as never, "location-a", "contact-a", {
      email: "",
    });

    assert.equal(updated?.email, null);
  });
});
