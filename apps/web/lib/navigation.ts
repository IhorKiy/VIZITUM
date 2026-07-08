export type RoleArea =
  | "field"
  | "field-planning"
  | "field-general"
  | "field-history"
  | "admin-setup"
  | "admin-users"
  | "admin-imports"
  | "admin-review"
  | "admin-settings"
  | "admin-locations"
  | "admin-products"
  | "manager-overview"
  | "manager-visits"
  | "manager-tasks"
  | "manager-locations"
  | "manager-representatives"
  | "operations";

export type Zone = "field" | "manager" | "admin" | "operations";

export const ZONE_ORDER: readonly Zone[] = [
  "field",
  "manager",
  "admin",
  "operations",
];

// Fixed per-zone entry point. `/admin` self-redirects to `/admin/setup`
// (apps/web/app/[tenantSlug]/admin/page.tsx), so this needs no permission
// awareness — every zone's bare path is always a safe landing spot for
// anyone who has that zone available.
const ZONE_HOME_PATH: Record<Zone, string> = {
  field: "/field",
  manager: "/manager",
  admin: "/admin",
  operations: "/operations",
};

export type NavItem = {
  href: string;
  area: RoleArea;
  zone: Zone;
  icon: string;
  requiredPermissions: string[];
};

type NavItemDef = {
  path: string;
  area: RoleArea;
  zone: Zone;
  icon: string;
  requiredPermissions: string[];
};

// Nav labels are translated in the UI via `common.nav.<area>`; this module
// stays a pure permission-filtered structure. Each item's `zone` groups it
// for the role-zone shell/switcher (components/app-shell.tsx) and mirrors
// the backend validation map in src/modules/auth/zones.ts — keep both in
// sync when an item's zone or requiredPermissions change.
const NAV_ITEM_DEFS: NavItemDef[] = [
  {
    path: "/field",
    area: "field",
    zone: "field",
    icon: "V",
    requiredPermissions: ["visits.read_own", "visits.read_team"],
  },
  {
    path: "/field/planning",
    area: "field-planning",
    zone: "field",
    icon: "N",
    requiredPermissions: ["routes.read"],
  },
  {
    path: "/field/general",
    area: "field-general",
    zone: "field",
    icon: "G",
    requiredPermissions: ["routes.manage_own"],
  },
  {
    path: "/field/history",
    area: "field-history",
    zone: "field",
    icon: "H",
    requiredPermissions: ["visits.read_own"],
  },
  {
    path: "/admin/setup",
    area: "admin-setup",
    zone: "admin",
    icon: "S",
    requiredPermissions: ["tenant.settings.read", "users.read", "imports.read"],
  },
  {
    path: "/admin/users",
    area: "admin-users",
    zone: "admin",
    icon: "U",
    requiredPermissions: ["users.read"],
  },
  {
    path: "/admin/imports",
    area: "admin-imports",
    zone: "admin",
    icon: "I",
    requiredPermissions: ["imports.read"],
  },
  {
    path: "/admin/locations",
    area: "admin-locations",
    zone: "admin",
    icon: "L",
    requiredPermissions: ["locations.manage"],
  },
  {
    path: "/admin/products",
    area: "admin-products",
    zone: "admin",
    icon: "K",
    requiredPermissions: ["products.manage"],
  },
  {
    path: "/admin/review",
    area: "admin-review",
    zone: "admin",
    icon: "P",
    requiredPermissions: ["pilot_review.read"],
  },
  {
    path: "/admin/settings",
    area: "admin-settings",
    zone: "admin",
    icon: "G",
    requiredPermissions: ["tenant.settings.read"],
  },
  {
    path: "/manager",
    area: "manager-overview",
    zone: "manager",
    icon: "M",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/manager/visits",
    area: "manager-visits",
    zone: "manager",
    icon: "R",
    requiredPermissions: ["visits.read_team"],
  },
  {
    path: "/manager/tasks",
    area: "manager-tasks",
    zone: "manager",
    icon: "T",
    requiredPermissions: ["tasks.read_team"],
  },
  {
    path: "/manager/locations",
    area: "manager-locations",
    zone: "manager",
    icon: "C",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/manager/representatives",
    area: "manager-representatives",
    zone: "manager",
    icon: "E",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/operations",
    area: "operations",
    zone: "operations",
    icon: "O",
    requiredPermissions: ["platform.operations.read"],
  },
];

function filterNavItemDefs(
  permissions?: string[],
  productsEnabled = true,
): NavItemDef[] {
  const visibleItems = productsEnabled
    ? NAV_ITEM_DEFS
    : NAV_ITEM_DEFS.filter((item) => item.area !== "admin-products");

  if (!permissions) {
    return visibleItems;
  }

  const permissionSet = new Set(permissions);

  return visibleItems.filter((item) =>
    item.requiredPermissions.some((permission) =>
      permissionSet.has(permission),
    ),
  );
}

export function buildTenantNav(
  tenantSlug: string,
  permissions?: string[],
  productsEnabled = true,
): NavItem[] {
  return filterNavItemDefs(permissions, productsEnabled).map((item) => ({
    href: `/${tenantSlug}${item.path}`,
    area: item.area,
    zone: item.zone,
    icon: item.icon,
    requiredPermissions: item.requiredPermissions,
  }));
}

// Derived once from NAV_ITEM_DEFS (single source of truth) rather than
// hand-duplicated, so a RoleArea can never silently drift from its zone.
const AREA_ZONE = new Map<RoleArea, Zone>(
  NAV_ITEM_DEFS.map((item) => [item.area, item.zone]),
);

export function zoneForArea(area: RoleArea): Zone {
  const zone = AREA_ZONE.get(area);

  if (!zone) {
    throw new Error(`Unknown nav area: ${area}`);
  }

  return zone;
}

export function availableZones(
  permissions?: string[],
  productsEnabled = true,
): Zone[] {
  const presentZones = new Set(
    filterNavItemDefs(permissions, productsEnabled).map((item) => item.zone),
  );

  return ZONE_ORDER.filter((zone) => presentZones.has(zone));
}

export function isZone(value: string | null | undefined): value is Zone {
  return !!value && (ZONE_ORDER as string[]).includes(value);
}

export function resolveDefaultZone(
  zones: Zone[],
  lastSelectedZone?: string | null,
): Zone | null {
  if (isZone(lastSelectedZone) && zones.includes(lastSelectedZone)) {
    return lastSelectedZone;
  }

  return zones.length === 1 ? zones[0] : null;
}

export function zoneHomePath(zone: Zone): string {
  return ZONE_HOME_PATH[zone];
}

export type ZoneLanding =
  | { kind: "zone"; zone: Zone }
  | { kind: "choose"; zones: Zone[] }
  | { kind: "no-access" };

// The single resolution order shared by the login redirect, the tenant-home
// redirect and the AppShell deep-link guard, so all three always agree on
// where a given user belongs.
export function resolveZoneLanding(
  permissions: string[] | undefined,
  productsEnabled: boolean,
  lastSelectedZone: string | null | undefined,
): ZoneLanding {
  const zones = availableZones(permissions, productsEnabled);

  if (zones.length === 0) {
    return { kind: "no-access" };
  }

  const zone = resolveDefaultZone(zones, lastSelectedZone);

  return zone ? { kind: "zone", zone } : { kind: "choose", zones };
}

export function normalizeTenantName(tenantSlug: string): string {
  return tenantSlug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
