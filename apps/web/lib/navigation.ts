// Areas that own a nav item, and therefore a `common.nav.<area>` label.
export type NavArea =
  | "field"
  | "field-routes"
  | "field-planning"
  | "field-history"
  | "field-tasks"
  | "admin-users"
  | "admin-pilot"
  | "admin-settings"
  | "admin-imports"
  | "admin-locations"
  | "admin-products"
  | "manager-overview"
  | "manager-visits"
  | "manager-tasks"
  | "manager-locations"
  | "manager-representatives"
  | "manager-potential"
  | "manager-announcements"
  | "operations";

/**
 * Areas with no nav item of their own: screens the field menu opens
 * (components/field-menu.tsx). They carry no nav label and never appear in the
 * bottom nav, but a page still declares one as its `activeArea` so the
 * AppShell can place it in a zone.
 */
export type MenuOnlyArea = "field-menu";

export type RoleArea = NavArea | MenuOnlyArea;

export type Zone = "field" | "manager" | "admin" | "operations";

// Semantic icon names for nav items; each maps to an SVG in
// components/nav-icon.tsx. Kept as a union so a missing/mistyped icon fails
// typecheck rather than silently rendering nothing.
export type NavIconName =
  | "home"
  | "route"
  | "calendar"
  | "grid"
  | "clock"
  | "flag"
  | "users"
  | "pin"
  | "box"
  | "upload"
  | "settings"
  | "layout"
  | "clipboard"
  | "check"
  | "activity"
  | "megaphone"
  | "help";

export const ZONE_ORDER: readonly Zone[] = [
  "field",
  "manager",
  "admin",
  "operations",
];

// Fixed per-zone entry point. `/admin` self-redirects to `/admin/settings`
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
  area: NavArea;
  zone: Zone;
  icon: NavIconName;
  requiredPermissions: string[];
};

type NavItemDef = {
  path: string;
  area: NavArea;
  zone: Zone;
  icon: NavIconName;
  requiredPermissions: string[];
};

// Nav labels are translated in the UI via `common.nav.<area>`; this module
// stays a pure permission-filtered structure. Each item's `zone` groups it
// for the role-zone shell/switcher (components/app-shell.tsx) and mirrors
// the backend validation map in src/modules/auth/zones.ts — keep both in
// sync when an item's zone or requiredPermissions change
// (tests/zone-permission-mirror.test.ts fails on any drift).
const NAV_ITEM_DEFS: NavItemDef[] = [
  {
    path: "/field",
    area: "field",
    zone: "field",
    icon: "home",
    requiredPermissions: ["visits.read_own", "visits.read_team"],
  },
  {
    // The rep's reusable routes: what a round looks like, independent of any
    // date. Split from the calendar below, which is where a route meets a day.
    path: "/field/routes",
    area: "field-routes",
    zone: "field",
    icon: "route",
    requiredPermissions: ["routes.read"],
  },
  {
    path: "/field/planning",
    area: "field-planning",
    zone: "field",
    icon: "calendar",
    requiredPermissions: ["routes.read"],
  },
  {
    path: "/field/tasks",
    area: "field-tasks",
    zone: "field",
    icon: "check",
    requiredPermissions: ["tasks.read_own"],
  },
  {
    path: "/field/history",
    area: "field-history",
    zone: "field",
    icon: "clock",
    requiredPermissions: ["visits.read_own"],
  },
  {
    // Temporary onboarding section: readiness checklist + pilot review. Shown
    // only while the tenant is on the pilot plan (filtered out via pilotActive
    // in filterNavItemDefs), so it disappears once the tenant graduates.
    //
    // Gated on tenant.settings.read (admin roles only), not on the
    // GET /pilot-review/summary endpoint's own pilot_review.read — that
    // permission is also held by team_manager, and zone availability is an OR
    // across every item in a zone, so gating on it here surfaced the entire
    // "admin" zone (switcher entry, zone chooser on login) to plain managers.
    // The section is admin work anyway: every checklist row is tenant
    // configuration only an admin can act on (admin access, roles, locations,
    // products, initial plan). Same reasoning as manager-potential below.
    path: "/admin/pilot",
    area: "admin-pilot",
    zone: "admin",
    icon: "flag",
    requiredPermissions: ["tenant.settings.read"],
  },
  {
    path: "/admin/users",
    area: "admin-users",
    zone: "admin",
    icon: "users",
    requiredPermissions: ["users.read"],
  },
  {
    path: "/admin/locations",
    area: "admin-locations",
    zone: "admin",
    icon: "pin",
    requiredPermissions: ["locations.manage"],
  },
  {
    path: "/admin/products",
    area: "admin-products",
    zone: "admin",
    icon: "box",
    requiredPermissions: ["products.manage"],
  },
  {
    path: "/admin/imports",
    area: "admin-imports",
    zone: "admin",
    icon: "upload",
    requiredPermissions: ["imports.read"],
  },
  {
    path: "/admin/settings",
    area: "admin-settings",
    zone: "admin",
    icon: "settings",
    requiredPermissions: ["tenant.settings.read"],
  },
  {
    path: "/manager",
    area: "manager-overview",
    zone: "manager",
    icon: "layout",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/manager/visits",
    area: "manager-visits",
    zone: "manager",
    icon: "clipboard",
    requiredPermissions: ["visits.read_team"],
  },
  {
    path: "/manager/tasks",
    area: "manager-tasks",
    zone: "manager",
    icon: "check",
    requiredPermissions: ["tasks.read_team"],
  },
  {
    path: "/manager/locations",
    area: "manager-locations",
    zone: "manager",
    icon: "pin",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/manager/representatives",
    area: "manager-representatives",
    zone: "manager",
    icon: "users",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    // Gated on dashboard.manager.read (team_manager only), not on the
    // location_insights.summary endpoint's own location_insights.read —
    // that permission is also held by field reps and admins (per the
    // permission spec), and nav zone availability is an OR across every
    // item in a zone, so gating on it here would newly surface the whole
    // "manager" zone to those roles just for this one item. Every
    // team_manager already holds both permissions, so this doesn't narrow
    // who can actually load the screen.
    path: "/manager/potential",
    area: "manager-potential",
    zone: "manager",
    icon: "box",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    // Gated on dashboard.manager.read rather than the endpoint's own
    // announcements.manage, for the same reason manager-potential is: that
    // permission is also held by tenant_superadmin as a no-screen repair
    // path, and zone availability is an OR across a zone's items, so gating
    // on it here would hand a superadmin the whole manager zone. Every
    // team_manager holds both, so nobody the screen is for loses it.
    path: "/manager/announcements",
    area: "manager-announcements",
    zone: "manager",
    icon: "megaphone",
    requiredPermissions: ["dashboard.manager.read"],
  },
  {
    path: "/operations",
    area: "operations",
    zone: "operations",
    icon: "activity",
    requiredPermissions: ["platform.operations.read"],
  },
];

// Areas hidden entirely when the tenant's productsEnabled flag is off — both
// depend on the product catalog (admin-products manages it directly;
// manager-potential reports on per-location coverage against it).
const PRODUCT_DEPENDENT_AREAS = new Set<RoleArea>([
  "admin-products",
  "manager-potential",
]);

function filterNavItemDefs(
  permissions?: string[],
  productsEnabled = true,
  pilotActive = true,
): NavItemDef[] {
  const visibleItems = NAV_ITEM_DEFS.filter(
    (item) =>
      (productsEnabled || !PRODUCT_DEPENDENT_AREAS.has(item.area)) &&
      (pilotActive || item.area !== "admin-pilot"),
  );

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
  pilotActive = true,
): NavItem[] {
  return filterNavItemDefs(permissions, productsEnabled, pilotActive).map(
    (item) => ({
      href: `/${tenantSlug}${item.path}`,
      area: item.area,
      zone: item.zone,
      icon: item.icon,
      requiredPermissions: item.requiredPermissions,
    }),
  );
}

// Screens that belong to a zone but carry no nav item of their own: the
// representative's locations, product catalogue and help pages are opened from
// the field menu (components/field-menu.tsx), not from the bottom nav. They
// still need a zone so the AppShell deep-link guard can place them.
//
// Deliberately kept out of NAV_ITEM_DEFS: a nav item's permissions widen its
// whole zone (availability is an OR across the zone's items), so listing these
// with locations.read/products.read would hand the field zone to every admin
// and manager who holds those. The screens enforce their own permissions
// server-side as before.
const MENU_ONLY_AREA_ZONE: Record<MenuOnlyArea, Zone> = {
  "field-menu": "field",
};

// Derived once from NAV_ITEM_DEFS (single source of truth) rather than
// hand-duplicated, so a RoleArea can never silently drift from its zone.
const AREA_ZONE = new Map<RoleArea, Zone>([
  ...NAV_ITEM_DEFS.map((item): [RoleArea, Zone] => [item.area, item.zone]),
  ...(Object.entries(MENU_ONLY_AREA_ZONE) as [RoleArea, Zone][]),
]);

// The field menu's own entries. Not nav items (see MENU_ONLY_AREA_ZONE) — this
// is a plain link list, labelled in the UI via `field.menu.<key>`.
export type FieldMenuLinkKey = "locations" | "products" | "help";

export type FieldMenuLink = {
  key: FieldMenuLinkKey;
  href: string;
  icon: NavIconName;
};

const FIELD_MENU_LINK_DEFS: {
  key: FieldMenuLinkKey;
  path: string;
  icon: NavIconName;
  /** Same shape as a nav item's, and read the same way: any one of them is enough. */
  requiredPermissions: string[];
}[] = [
  {
    key: "locations",
    path: "/field/locations",
    icon: "pin",
    requiredPermissions: ["locations.read"],
  },
  {
    key: "products",
    path: "/field/products",
    icon: "box",
    requiredPermissions: ["products.read"],
  },
  // No permission of its own: the answers are reference text, and they are most
  // useful exactly when the API — and with it the session's permission list —
  // is the thing that failed.
  { key: "help", path: "/field/help", icon: "help", requiredPermissions: [] },
];

// Argument order mirrors buildTenantNav's, and the permission filter works the
// same way, so a menu entry can't offer a screen that answers "you need access"
// — the screens still check for themselves.
export function buildFieldMenuLinks(
  tenantSlug: string,
  permissions?: string[],
  productsEnabled = true,
): FieldMenuLink[] {
  const permissionSet = permissions ? new Set(permissions) : null;

  return FIELD_MENU_LINK_DEFS.filter(
    (link) =>
      (productsEnabled || link.key !== "products") &&
      (!permissionSet ||
        link.requiredPermissions.length === 0 ||
        link.requiredPermissions.some((permission) =>
          permissionSet.has(permission),
        )),
  ).map((link) => ({
    key: link.key,
    href: `/${tenantSlug}${link.path}`,
    icon: link.icon,
  }));
}

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
  pilotActive = true,
): Zone[] {
  const presentZones = new Set(
    filterNavItemDefs(permissions, productsEnabled, pilotActive).map(
      (item) => item.zone,
    ),
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
  pilotActive = true,
): ZoneLanding {
  const zones = availableZones(permissions, productsEnabled, pilotActive);

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
