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
  permissions: [PERMISSIONS.LOCATION_NOTES_MANAGE],
};

function locationRow(notes: string | null = null) {
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
    notes,
    chain: null,
    category: null,
    contacts: [],
    assignments: [],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deletedAt: null,
  };
}

describe("updateLocationNotes input validation", () => {
  it("rejects a non-string note with 400 LOCATION_NOTES_INVALID and does not write", async () => {
    let updateCalled = false;
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow(),
        update: async () => {
          updateCalled = true;
          return locationRow();
        },
      },
    } as never);

    await assert.rejects(
      // A tampered/malformed body sends a number instead of a string.
      service.updateLocationNotes(context as never, "location-a", {
        notes: 42 as unknown,
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "LOCATION_NOTES_INVALID");
        return true;
      },
    );
    assert.equal(updateCalled, false);
  });

  it("stores a trimmed string note", async () => {
    let updateData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow(),
        update: async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return locationRow("Best contact after 2pm");
        },
      },
    } as never);

    await service.updateLocationNotes(context as never, "location-a", {
      notes: "  Best contact after 2pm  ",
    });

    assert.equal(updateData?.notes, "Best contact after 2pm");
  });

  it("clears the note when given a blank string", async () => {
    let updateData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow("old"),
        update: async (args: { data: Record<string, unknown> }) => {
          updateData = args.data;
          return locationRow(null);
        },
      },
    } as never);

    await service.updateLocationNotes(context as never, "location-a", {
      notes: "   ",
    });

    assert.equal(updateData?.notes, null);
  });
});
