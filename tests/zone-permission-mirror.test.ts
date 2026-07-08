import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTenantNav, ZONE_ORDER } from "../apps/web/lib/navigation";
import { ZONE_PERMISSIONS, ZONE_VALUES } from "../src/modules/auth/zones";

// The backend's ZONE_PERMISSIONS (src/modules/auth/zones.ts, validates
// POST /auth/zone) is a hand-maintained mirror of the zone tags on the nav
// item definitions in apps/web/lib/navigation.ts. Nothing but this test
// stops them from drifting apart — e.g. a nav item added with a new
// permission would make the frontend offer a zone the backend then rejects
// with ZONE_NOT_AVAILABLE.
describe("zone permission mirror (frontend navigation vs backend zones)", () => {
  it("both sides agree on the set of zones", () => {
    assert.deepEqual([...ZONE_VALUES].sort(), [...ZONE_ORDER].sort());
  });

  it("each zone's backend permission list equals the union of that zone's nav item requiredPermissions", () => {
    // permissions=undefined + productsEnabled=true returns every nav item
    // unfiltered — the full definition list, same as the demo/unauth render.
    const items = buildTenantNav("acme", undefined, true);

    for (const zone of ZONE_ORDER) {
      const frontendUnion = [
        ...new Set(
          items
            .filter((item) => item.zone === zone)
            .flatMap((item) => item.requiredPermissions),
        ),
      ].sort();
      const backendPermissions = [...new Set<string>(ZONE_PERMISSIONS[zone])]
        .sort();

      assert.deepEqual(
        backendPermissions,
        frontendUnion,
        `zone "${zone}" drifted between src/modules/auth/zones.ts and apps/web/lib/navigation.ts`,
      );
    }
  });
});
