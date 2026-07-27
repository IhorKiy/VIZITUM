import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCanManageAssortment,
  assertCanManagePotential,
  canManageAssortment,
  canManagePotential,
} from "../src/modules/location-insights/location-insights-access";
import { PERMISSIONS } from "../src/modules/roles/permissions";

const baseContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN],
};

describe("canManageAssortment", () => {
  it("allows a caller holding the assortment permission", () => {
    const context = {
      ...baseContext,
      roleCodes: ["team_manager"],
      permissions: [PERMISSIONS.LOCATION_ASSORTMENT_MANAGE],
    };

    assert.equal(canManageAssortment(context as never), true);
  });

  it("forbids a representative who can only manage the potential", () => {
    // The whole point of the split: an assignment does not buy write access to
    // the assortment, so the standard a manager sets cannot be edited from the
    // field.
    assert.equal(canManageAssortment(baseContext as never), false);
  });

  it("forbids a caller with neither permission", () => {
    const context = { ...baseContext, permissions: [] };

    assert.equal(canManageAssortment(context as never), false);
  });
});

describe("assertCanManageAssortment", () => {
  it("does not throw when the caller can manage", () => {
    const context = {
      ...baseContext,
      permissions: [PERMISSIONS.LOCATION_ASSORTMENT_MANAGE],
    };

    assert.doesNotThrow(() => assertCanManageAssortment(context as never));
  });

  it("throws a 403 LOCATION_ASSORTMENT_SCOPE_FORBIDDEN when the caller cannot manage", () => {
    assert.throws(
      () => assertCanManageAssortment(baseContext as never),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_ASSORTMENT_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });
});

describe("canManagePotential", () => {
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

    const canManage = await canManagePotential(
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

    const canManage = await canManagePotential(
      baseContext as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });

  it("forbids a manager holding only the assortment permission", async () => {
    const prisma = {}; // no locationAssignment.findFirst — would throw if called
    const context = {
      ...baseContext,
      roleCodes: ["team_manager"],
      permissions: [PERMISSIONS.LOCATION_ASSORTMENT_MANAGE],
    };

    const canManage = await canManagePotential(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });

  it("forbids a caller with neither permission", async () => {
    const prisma = {};
    const context = { ...baseContext, permissions: [] };

    const canManage = await canManagePotential(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });

  it("forbids manage_own defensively when context.userId is missing", async () => {
    const prisma = {}; // no locationAssignment.findFirst — would throw if called
    const context = { ...baseContext, userId: undefined };

    const canManage = await canManagePotential(
      context as never,
      prisma as never,
      "location-a",
    );

    assert.equal(canManage, false);
  });
});

describe("assertCanManagePotential", () => {
  it("resolves without throwing when the caller can manage", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => ({ id: "assignment-a" }) },
    };

    await assert.doesNotReject(
      assertCanManagePotential(
        baseContext as never,
        prisma as never,
        "location-a",
      ),
    );
  });

  it("throws a 403 LOCATION_POTENTIAL_SCOPE_FORBIDDEN when the caller cannot manage", async () => {
    const prisma = {
      locationAssignment: { findFirst: async () => null },
    };

    await assert.rejects(
      assertCanManagePotential(
        baseContext as never,
        prisma as never,
        "location-a",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(
          error.getResponse?.().code,
          "LOCATION_POTENTIAL_SCOPE_FORBIDDEN",
        );
        return true;
      },
    );
  });
});
