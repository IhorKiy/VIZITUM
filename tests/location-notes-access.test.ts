import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCanManageLocationNotes,
  canManageLocationHeader,
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

describe("canManageLocationHeader", () => {
  it("resolves both flags with a single assignment lookup for a field rep", async () => {
    let findFirstCalls = 0;
    const prisma = {
      locationAssignment: {
        findFirst: async () => {
          findFirstCalls += 1;
          return { id: "assignment-a" };
        },
      },
    };
    const context = {
      ...baseContext,
      permissions: [
        PERMISSIONS.LOCATION_NOTES_MANAGE_OWN,
        PERMISSIONS.CONTACTS_MANAGE_OWN,
      ],
    };

    const result = await canManageLocationHeader(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.deepEqual(result, {
      canManageNotes: true,
      canManageContacts: true,
    });
    assert.equal(findFirstCalls, 1);
  });

  it("skips the assignment lookup entirely when both are full-manage", async () => {
    const prisma = {}; // no locationAssignment — would throw if queried
    const context = {
      ...baseContext,
      permissions: [
        PERMISSIONS.LOCATION_NOTES_MANAGE,
        PERMISSIONS.CONTACTS_MANAGE,
      ],
    };

    const result = await canManageLocationHeader(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.deepEqual(result, {
      canManageNotes: true,
      canManageContacts: true,
    });
  });

  it("denies both when an own-tier rep has no active assignment", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => null },
    };
    const context = {
      ...baseContext,
      permissions: [
        PERMISSIONS.LOCATION_NOTES_MANAGE_OWN,
        PERMISSIONS.CONTACTS_MANAGE_OWN,
      ],
    };

    const result = await canManageLocationHeader(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.deepEqual(result, {
      canManageNotes: false,
      canManageContacts: false,
    });
  });
});
