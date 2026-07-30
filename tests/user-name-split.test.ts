import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUserNameFields,
  composeUserDisplayName,
  normalizeNamePart,
} from "../src/common/person-name";
import { UsersService } from "../src/modules/users/users.service";

// `User.firstName`/`lastName` are the stored truth and `User.name` is derived
// from them. The whole arrangement only holds if `name` is never written on its
// own, so what these pin is the composition rule and the one write path where a
// caller can change a single part.

describe("user display name composition", () => {
  it("joins the two parts, and falls back to the given name alone", () => {
    assert.equal(composeUserDisplayName("Олена", "Ковальчук"), "Олена Ковальчук");
    assert.equal(composeUserDisplayName("Owner", null), "Owner");
  });

  it("collapses interior whitespace so a stray double space can't split wrong", () => {
    assert.equal(normalizeNamePart("  Петро   Гриценко  "), "Петро Гриценко");
    assert.equal(normalizeNamePart("   "), null);
    assert.equal(normalizeNamePart(42), null);
  });

  it("builds all three columns together, never name alone", () => {
    assert.deepEqual(
      buildUserNameFields({ firstName: "Ігор", lastName: "Кій" }),
      { firstName: "Ігор", lastName: "Кій", name: "Ігор Кій" },
    );
  });
});

describe("updateUser name edits", () => {
  function createService(captured: { data?: Record<string, unknown> }) {
    const storedUser = {
      id: "user-a",
      tenantId: "tenant-a",
      email: "rep@example.com",
      firstName: "Олена",
      lastName: "Ковальчук",
      name: "Олена Ковальчук",
      phone: null,
      status: "active",
      deletedAt: null,
      lastSelectedRoleCode: null,
      roles: [{ roleCode: "field_representative" }],
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    };

    const client = {
      user: {
        findFirst: async () => storedUser,
        update: async (query: { data: Record<string, unknown> }) => {
          captured.data = query.data;

          return { ...storedUser, ...query.data };
        },
      },
      platformTenant: {
        findUniqueOrThrow: async () => ({ phoneCountry: "UA" }),
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(client),
    };

    return new UsersService(
      client as never,
      { recordEvent: async () => {} } as never,
      { revokeUserSessions: async () => {} } as never,
      {} as never,
      {} as never,
    );
  }

  const context = {
    requestId: "request-a",
    tenantId: "tenant-a",
    tenantSlug: "tenant-a",
    userId: "actor-a",
    roleCodes: ["company_admin"],
    permissions: ["users.manage", "admins.manage"],
  };

  it("recomposes the display name when only the surname changes", async () => {
    const captured: { data?: Record<string, unknown> } = {};
    const service = createService(captured);

    const updated = await service.updateUser(context as never, "user-a", {
      lastName: "Мельник",
    });

    // The given name comes from the stored row, not the request — otherwise a
    // surname-only edit would leave `name` carrying the old pair.
    assert.deepEqual(captured.data, {
      firstName: "Олена",
      lastName: "Мельник",
      name: "Олена Мельник",
    });
    assert.equal(updated.name, "Олена Мельник");
    assert.equal(updated.firstName, "Олена");
  });

  it("leaves every name column alone when neither part is supplied", async () => {
    const captured: { data?: Record<string, unknown> } = {};
    const service = createService(captured);

    await service.updateUser(context as never, "user-a", { status: "suspended" });

    assert.equal(captured.data?.firstName, undefined);
    assert.equal(captured.data?.lastName, undefined);
    assert.equal(captured.data?.name, undefined);
  });
});
