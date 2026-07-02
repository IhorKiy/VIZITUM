export type RoleArea = "field" | "admin" | "manager" | "operations";

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
      label: "Imports",
      href: `/${tenantSlug}/admin/imports`,
      area: "admin",
      icon: "I",
      requiredPermissions: ["imports.read"],
    },
    {
      label: "Manager",
      href: `/${tenantSlug}/manager`,
      area: "manager",
      icon: "M",
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
