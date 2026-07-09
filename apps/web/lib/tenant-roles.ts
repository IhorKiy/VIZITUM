import type { TenantRoleCode } from "./api-client";

// Assignable tenant roles, in display order. Excludes `tenant_superadmin`,
// which is never invited or toggled through the tenant admin UI. Single source
// shared by the users screen and the invite modal so they can't drift.
export const TENANT_ROLES: TenantRoleCode[] = [
  "company_admin",
  "team_manager",
  "field_representative",
];
