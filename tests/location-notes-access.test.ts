import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCanManageLocationNotes,
  canManageLocationNotes,
} from "../src/modules/locations/locations-write-access";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const baseContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.LOCATION_NOTES_MANAGE_OWN],
};

describe("canManageLocationNotes", () => {
  it("allows a caller with the manage permission without checking assignments", async () => {
    const prisma = {}; // no locationAssignment.findFirst — would throw if called
    const context = {
      ...baseContext,
      permissions: [PERMISSIONS.LOCATION_NOTES_MANAGE],
    };

    const canManage = await canManageLocationNotes(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, true);
  });

  it("allows manage_own when an active assignment exists", async () => {
    let capturedWhere: unknown;
    const prisma = {
      locationAssignment: {
        findFirst: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return { id: "assignment-a" };
        },
      },
    };

    const canManage = await canManageLocationNotes(
      baseContext as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, true);
    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      status: "active",
    });
  });

  it("forbids manage_own when no active assignment exists", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => null },
    };

    const canManage = await canManageLocationNotes(
      baseContext as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });

  it("forbids a caller with neither permission", async () => {
    const prisma = {};
    const context = { ...baseContext, permissions: [] };

    const canManage = await canManageLocationNotes(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });

  it("forbids manage_own defensively when context.userId is missing", async () => {
    const prisma = {}; // no locationAssignment.findFirst — would throw if called
    const context = { ...baseContext, userId: undefined };

    const canManage = await canManageLocationNotes(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });
});

describe("assertCanManageLocationNotes", () => {
  it("resolves without throwing when the caller can manage", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => ({ id: "assignment-a" }) },
    };

    await assert.doesNotReject(
      assertCanManageLocationNotes(
        baseContext as never,
        prisma as never,
        "location-a",
      ),
    );
  });

  it("throws a 403 LOCATION_NOTES_SCOPE_FORBIDDEN when the caller cannot manage", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => null },
    };

    await assert.rejects(
      assertCanManageLocationNotes(
        baseContext as never,
        prisma as never,
        "location-a",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_NOTES_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });
});
