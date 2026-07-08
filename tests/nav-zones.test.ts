import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableZones,
  buildTenantNav,
  resolveDefaultZone,
  resolveZoneLanding,
  zoneForArea,
  zoneHomePath,
  ZONE_ORDER,
} from "../apps/web/lib/navigation";

// Mirrors src/modules/roles/role-permission.matrix.ts as permission
// *strings* (navigation.ts is framework-free and doesn't import PermissionCode).
const FIELD_REPRESENTATIVE_PERMISSIONS = [
  "locations.read",
  "contacts.read",
  "products.read",
  "routes.read",
  "routes.manage_own",
  "visits.read_own",
  "visits.create",
  "visits.update_own",
  "visits.cancel_own",
  "reports.read_own",
  "reports.confirm_own",
  "tasks.read_own",
  "tasks.create",
  "tasks.update_own",
  "ai.use_reporting",
];

const TEAM_MANAGER_PERMISSIONS = [
  "locations.read",
  "contacts.read",
  "products.read",
  "routes.read",
  "routes.manage_team",
  "visits.read_team",
  "reports.read_team",
  "tasks.read_team",
  "tasks.create",
  "tasks.update_team",
  "dashboard.manager.read",
  "pilot_review.read",
];

const COMPANY_ADMIN_PERMISSIONS = [
  "tenant.settings.read",
  "tenant.settings.manage",
  "users.read",
  "users.invite",
  "users.manage",
  "roles.assign",
  "locations.read",
  "locations.manage",
  "locations.assign",
  "contacts.read",
  "contacts.manage",
  "products.read",
  "products.manage",
  "imports.read",
  "imports.upload",
  "imports.confirm",
  "audit.read",
];

describe("navigation zones", () => {
  it("tags nav items with the zone matching their URL prefix", () => {
    const items = buildTenantNav("acme", undefined);
    const byArea = new Map(items.map((item) => [item.area, item.zone]));

    assert.equal(byArea.get("field"), "field");
    assert.equal(byArea.get("field-planning"), "field");
    assert.equal(byArea.get("admin-review"), "admin");
    assert.equal(byArea.get("manager-overview"), "manager");
    assert.equal(byArea.get("operations"), "operations");
  });

  it("zoneForArea agrees with buildTenantNav's own zone tag for every area", () => {
    const items = buildTenantNav("acme", undefined);

    for (const item of items) {
      assert.equal(zoneForArea(item.area), item.zone);
    }
  });

  it("a field representative only has the field zone available", () => {
    assert.deepEqual(availableZones(FIELD_REPRESENTATIVE_PERMISSIONS), [
      "field",
    ]);
  });

  it("a company admin only has the admin zone available", () => {
    assert.deepEqual(availableZones(COMPANY_ADMIN_PERMISSIONS), ["admin"]);
  });

  it("admin zone availability does not depend on productsEnabled", () => {
    // products.manage is the only admin-zone permission gated by
    // productsEnabled (it only hides the admin-products *item*, see
    // buildTenantNav); every real admin role also holds
    // tenant.settings.read/users.read/imports.read, so the zone itself
    // stays available either way.
    assert.deepEqual(availableZones(COMPANY_ADMIN_PERMISSIONS, true), [
      "admin",
    ]);
    assert.deepEqual(availableZones(COMPANY_ADMIN_PERMISSIONS, false), [
      "admin",
    ]);
  });

  it("a plain team manager sees field, manager and admin (documented overlap, not a bug)", () => {
    // Deriving zone availability from each item's existing
    // requiredPermissions (not a parallel mapping) means team_manager's
    // visits.read_team/routes.read also satisfy the field-zone "field" and
    // "field-planning" items, and pilot_review.read (granted only to
    // team_manager — see the "Known gaps" note in permissions.md) satisfies
    // admin-review. See module-map.md's "Known cross-zone overlap" note.
    assert.deepEqual(availableZones(TEAM_MANAGER_PERMISSIONS), [
      "field",
      "manager",
      "admin",
    ]);
  });

  it("the operations zone requires platform.operations.read", () => {
    assert.deepEqual(availableZones(["platform.operations.read"]), [
      "operations",
    ]);
    assert.ok(!availableZones(TEAM_MANAGER_PERMISSIONS).includes("operations"));
  });

  it("no permissions means no zones", () => {
    assert.deepEqual(availableZones([]), []);
  });

  it("an absent permission list returns every zone, in ZONE_ORDER", () => {
    // Matches buildTenantNav's own "no filter" behavior when permissions is
    // undefined (used for the unauthenticated/demo render path).
    assert.deepEqual(availableZones(undefined), ZONE_ORDER);
  });

  it("resolveDefaultZone prefers a stored zone that is still available", () => {
    assert.equal(
      resolveDefaultZone(["field", "manager", "admin"], "admin"),
      "admin",
    );
  });

  it("resolveDefaultZone ignores a stored zone that is no longer available", () => {
    assert.equal(resolveDefaultZone(["manager"], "admin"), "manager");
  });

  it("resolveDefaultZone falls back to the only available zone with no stored choice", () => {
    assert.equal(resolveDefaultZone(["field"], null), "field");
    assert.equal(resolveDefaultZone(["field"], undefined), "field");
  });

  it("resolveDefaultZone returns null when multiple zones are available and none is stored", () => {
    assert.equal(resolveDefaultZone(["field", "manager"], null), null);
  });

  it("resolveZoneLanding: no zones available -> no-access", () => {
    assert.deepEqual(resolveZoneLanding([], true, null), {
      kind: "no-access",
    });
  });

  it("resolveZoneLanding: exactly one zone -> zone", () => {
    assert.deepEqual(
      resolveZoneLanding(FIELD_REPRESENTATIVE_PERMISSIONS, true, null),
      { kind: "zone", zone: "field" },
    );
  });

  it("resolveZoneLanding: multiple zones with a still-valid stored choice -> zone", () => {
    assert.deepEqual(
      resolveZoneLanding(TEAM_MANAGER_PERMISSIONS, true, "admin"),
      { kind: "zone", zone: "admin" },
    );
  });

  it("resolveZoneLanding: multiple zones, no stored choice -> choose", () => {
    assert.deepEqual(
      resolveZoneLanding(TEAM_MANAGER_PERMISSIONS, true, null),
      { kind: "choose", zones: ["field", "manager", "admin"] },
    );
  });

  it("resolveZoneLanding: a stale stored zone falls through silently, no write side effect", () => {
    // "stale" here means no longer available (e.g. roles changed) — the
    // resolver just ignores it in favor of the normal order, it never
    // mutates anything itself (persistence only happens on an explicit pick).
    assert.deepEqual(
      resolveZoneLanding(FIELD_REPRESENTATIVE_PERMISSIONS, true, "admin"),
      { kind: "zone", zone: "field" },
    );
  });

  it("zoneHomePath returns a fixed per-zone entry path", () => {
    assert.equal(zoneHomePath("field"), "/field");
    assert.equal(zoneHomePath("manager"), "/manager");
    assert.equal(zoneHomePath("admin"), "/admin");
    assert.equal(zoneHomePath("operations"), "/operations");
  });
});
