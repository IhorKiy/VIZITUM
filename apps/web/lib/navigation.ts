export type RoleArea = "field" | "admin" | "manager";

export type NavItem = {
  label: string;
  href: string;
  area: RoleArea;
  icon: string;
};

export function buildTenantNav(tenantSlug: string): NavItem[] {
  return [
    {
      label: "Field",
      href: `/${tenantSlug}/field`,
      area: "field",
      icon: "V",
    },
    {
      label: "Imports",
      href: `/${tenantSlug}/admin/imports`,
      area: "admin",
      icon: "I",
    },
    {
      label: "Manager",
      href: `/${tenantSlug}/manager`,
      area: "manager",
      icon: "M",
    },
  ];
}

export function normalizeTenantName(tenantSlug: string): string {
  return tenantSlug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
