export type RoleArea =
  | "field"
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
  | "operations";

export type NavItem = {
  label: string;
  href: string;
  area: RoleArea;
  icon: string;
  requiredPermissions: string[];
};

export function buildTenantNav(
  tenantSlug: string,
  permissions?: string[],
): NavItem[] {
  const navItems: NavItem[] = [
    {
      label: "Field",
      href: `/${tenantSlug}/field`,
      area: "field",
      icon: "V",
      requiredPermissions: ["visits.read_own", "visits.read_team"],
    },
    {
      label: "Setup",
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
      label: "Users",
      href: `/${tenantSlug}/admin/users`,
      area: "admin-users",
      icon: "U",
      requiredPermissions: ["users.read"],
    },
    {
      label: "Imports",
      href: `/${tenantSlug}/admin/imports`,
      area: "admin-imports",
      icon: "I",
      requiredPermissions: ["imports.read"],
    },
    {
      label: "Locations",
      href: `/${tenantSlug}/admin/locations`,
      area: "admin-locations",
      icon: "L",
      requiredPermissions: ["locations.read"],
    },
    {
      label: "Products",
      href: `/${tenantSlug}/admin/products`,
      area: "admin-products",
      icon: "K",
      requiredPermissions: ["products.read"],
    },
    {
      label: "Review",
      href: `/${tenantSlug}/admin/review`,
      area: "admin-review",
      icon: "P",
      requiredPermissions: ["pilot_review.read"],
    },
    {
      label: "Settings",
      href: `/${tenantSlug}/admin/settings`,
      area: "admin-settings",
      icon: "G",
      requiredPermissions: ["tenant.settings.read"],
    },
    {
      label: "Manager",
      href: `/${tenantSlug}/manager`,
      area: "manager-overview",
      icon: "M",
      requiredPermissions: ["dashboard.manager.read"],
    },
    {
      label: "Visits",
      href: `/${tenantSlug}/manager/visits`,
      area: "manager-visits",
      icon: "R",
      requiredPermissions: ["visits.read_team"],
    },
    {
      label: "Tasks",
      href: `/${tenantSlug}/manager/tasks`,
      area: "manager-tasks",
      icon: "T",
      requiredPermissions: ["tasks.read_team"],
    },
    {
      label: "Coverage",
      href: `/${tenantSlug}/manager/locations`,
      area: "manager-locations",
      icon: "C",
      requiredPermissions: ["dashboard.manager.read"],
    },
    {
      label: "Ops",
      href: `/${tenantSlug}/operations`,
      area: "operations",
      icon: "O",
      requiredPermissions: ["platform.operations.read"],
    },
  ];

  if (!permissions) {
    return navItems;
  }

  const permissionSet = new Set(permissions);

  return navItems.filter((item) =>
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
