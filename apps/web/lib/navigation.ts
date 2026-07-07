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

export type NavItem = {
  href: string;
  area: RoleArea;
  icon: string;
  requiredPermissions: string[];
};

// Nav labels are translated in the UI via `common.nav.<area>`; this module
// stays a pure permission-filtered structure.

export function buildTenantNav(
  tenantSlug: string,
  permissions?: string[],
  productsEnabled = true,
): NavItem[] {
  const navItems: NavItem[] = [
    {
      href: `/${tenantSlug}/field`,
      area: "field",
      icon: "V",
      requiredPermissions: ["visits.read_own", "visits.read_team"],
    },
    {
      href: `/${tenantSlug}/field/planning`,
      area: "field-planning",
      icon: "N",
      requiredPermissions: ["routes.read"],
    },
    {
      href: `/${tenantSlug}/field/general`,
      area: "field-general",
      icon: "G",
      requiredPermissions: ["routes.manage_own"],
    },
    {
      href: `/${tenantSlug}/field/history`,
      area: "field-history",
      icon: "H",
      requiredPermissions: ["visits.read_own"],
    },
    {
      href: `/${tenantSlug}/admin/setup`,
      area: "admin-setup",
      icon: "S",
      requiredPermissions: [
        "tenant.settings.read",
        "users.read",
        "imports.read",
      ],
    },
    {
      href: `/${tenantSlug}/admin/users`,
      area: "admin-users",
      icon: "U",
      requiredPermissions: ["users.read"],
    },
    {
      href: `/${tenantSlug}/admin/imports`,
      area: "admin-imports",
      icon: "I",
      requiredPermissions: ["imports.read"],
    },
    {
      href: `/${tenantSlug}/admin/locations`,
      area: "admin-locations",
      icon: "L",
      requiredPermissions: ["locations.manage"],
    },
    {
      href: `/${tenantSlug}/admin/products`,
      area: "admin-products",
      icon: "K",
      requiredPermissions: ["products.manage"],
    },
    {
      href: `/${tenantSlug}/admin/review`,
      area: "admin-review",
      icon: "P",
      requiredPermissions: ["pilot_review.read"],
    },
    {
      href: `/${tenantSlug}/admin/settings`,
      area: "admin-settings",
      icon: "G",
      requiredPermissions: ["tenant.settings.read"],
    },
    {
      href: `/${tenantSlug}/manager`,
      area: "manager-overview",
      icon: "M",
      requiredPermissions: ["dashboard.manager.read"],
    },
    {
      href: `/${tenantSlug}/manager/visits`,
      area: "manager-visits",
      icon: "R",
      requiredPermissions: ["visits.read_team"],
    },
    {
      href: `/${tenantSlug}/manager/tasks`,
      area: "manager-tasks",
      icon: "T",
      requiredPermissions: ["tasks.read_team"],
    },
    {
      href: `/${tenantSlug}/manager/locations`,
      area: "manager-locations",
      icon: "C",
      requiredPermissions: ["dashboard.manager.read"],
    },
    {
      href: `/${tenantSlug}/manager/representatives`,
      area: "manager-representatives",
      icon: "E",
      requiredPermissions: ["dashboard.manager.read"],
    },
    {
      href: `/${tenantSlug}/operations`,
      area: "operations",
      icon: "O",
      requiredPermissions: ["platform.operations.read"],
    },
  ];

  const visibleItems = productsEnabled
    ? navItems
    : navItems.filter((item) => item.area !== "admin-products");

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

export function normalizeTenantName(tenantSlug: string): string {
  return tenantSlug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
