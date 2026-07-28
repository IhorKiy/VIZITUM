import type { NavZone } from "@prisma/client";

import { PERMISSIONS, type PermissionCode } from "../roles/permissions";

export const ZONE_VALUES: NavZone[] = [
  "field",
  "manager",
  "admin",
  "operations",
];

// Mirrors the zone tags on nav items in apps/web/lib/navigation.ts: a zone is
// available when the user holds at least one permission gating a nav item
// tagged with that zone. Keep both lists in sync when a nav item moves zones
// or its requiredPermissions change — tests/zone-permission-mirror.test.ts
// fails on any drift (exported for that test). This is not a new authorization
// layer — every controller still enforces its own
// @RequirePermissions/@RequireAnyPermissions; this only validates a stored UI
// preference against the user's real permissions.
export const ZONE_PERMISSIONS: Record<NavZone, PermissionCode[]> = {
  field: [
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_READ_TEAM,
    PERMISSIONS.ROUTES_READ,
    PERMISSIONS.TASKS_READ_OWN,
  ],
  manager: [
    PERMISSIONS.DASHBOARD_MANAGER_READ,
    PERMISSIONS.VISITS_READ_TEAM,
    PERMISSIONS.TASKS_READ_TEAM,
  ],
  admin: [
    PERMISSIONS.TENANT_SETTINGS_READ,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.IMPORTS_READ,
    PERMISSIONS.LOCATIONS_MANAGE,
    PERMISSIONS.PRODUCTS_MANAGE,
  ],
  operations: [PERMISSIONS.PLATFORM_OPERATIONS_READ],
};

export function isValidZone(value: unknown): value is NavZone {
  return typeof value === "string" && (ZONE_VALUES as string[]).includes(value);
}

export function isZoneAvailable(
  zone: NavZone,
  permissions: PermissionCode[],
): boolean {
  const permissionSet = new Set(permissions);

  return ZONE_PERMISSIONS[zone].some((permission) =>
    permissionSet.has(permission),
  );
}
