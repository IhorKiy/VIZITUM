import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ROLE_PERMISSION_MATRIX,
  type AppRoleCode,
} from "../src/modules/roles/role-permission.matrix";

// PermissionGuard resolves identity by building a candidate context for
// every credential present on the request (bearer token, platform session,
// tenant session) and picking whichever one satisfies the route's declared
// permissions — see buildRequestContextCandidates in
// src/modules/auth/permission.guard.ts. That is only unambiguous while no
// permission is grantable from both auth domains: if a tenant role ever
// gained a platform permission (or vice versa), the guard's hardcoded
// candidate order would silently decide which identity wins on any route
// requiring it. docs/reference/permissions.md documents the invariant; this
// test makes breaking it a hard failure instead of a silent behavior change.
describe("role permission domain disjointness (platform vs tenant)", () => {
  const tenantRoleCodes = (
    Object.keys(ROLE_PERMISSION_MATRIX) as AppRoleCode[]
  ).filter((roleCode) => roleCode !== "platform_owner");

  it("no tenant role shares a permission with the platform_owner set", () => {
    const platformPermissions = new Set<string>(
      ROLE_PERMISSION_MATRIX.platform_owner,
    );

    for (const roleCode of tenantRoleCodes) {
      const overlap = ROLE_PERMISSION_MATRIX[roleCode].filter((permission) =>
        platformPermissions.has(permission),
      );

      assert.deepEqual(
        overlap,
        [],
        `tenant role "${roleCode}" shares permissions with platform_owner (${overlap.join(", ")}) — PermissionGuard's candidate resolution relies on the domains staying disjoint`,
      );
    }
  });

  // The namespace rule is what keeps the sets disjoint as they grow: every
  // platform permission lives under `platform.`, and no tenant role may
  // reach into that namespace.
  it("platform_owner permissions are exactly the `platform.`-prefixed ones", () => {
    for (const permission of ROLE_PERMISSION_MATRIX.platform_owner) {
      assert.ok(
        permission.startsWith("platform."),
        `platform_owner permission "${permission}" is outside the platform. namespace`,
      );
    }
  });

  it("no tenant role holds a `platform.`-prefixed permission", () => {
    for (const roleCode of tenantRoleCodes) {
      for (const permission of ROLE_PERMISSION_MATRIX[roleCode]) {
        assert.ok(
          !permission.startsWith("platform."),
          `tenant role "${roleCode}" holds platform-namespaced permission "${permission}"`,
        );
      }
    }
  });
});
