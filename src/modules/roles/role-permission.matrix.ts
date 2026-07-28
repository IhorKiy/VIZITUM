import type { RoleCode } from "@prisma/client";

import { PERMISSIONS, type PermissionCode } from "./permissions";

export const ROLE_PERMISSION_MATRIX_VERSION = "2026-07-28-announcements-v1";

export type PlatformRoleCode = "platform_owner";
export type TenantRoleCode = RoleCode;
export type AppRoleCode = PlatformRoleCode | TenantRoleCode;

const COMPANY_ADMIN_PERMISSIONS = [
  PERMISSIONS.TENANT_SETTINGS_READ,
  PERMISSIONS.TENANT_SETTINGS_MANAGE,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_INVITE,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.LOCATIONS_READ,
  PERMISSIONS.LOCATIONS_MANAGE,
  PERMISSIONS.LOCATIONS_ASSIGN,
  // Read-only on purpose: the admin zone reports on potential and assortment,
  // it does not author them (the manager owns the assortment, the assigned
  // representative owns the potential). tenant_superadmin adds
  // LOCATION_ASSORTMENT_MANAGE below purely as a service-level fallback.
  PERMISSIONS.LOCATION_INSIGHTS_READ,
  PERMISSIONS.LOCATION_NOTES_MANAGE,
  PERMISSIONS.CONTACTS_READ,
  PERMISSIONS.CONTACTS_MANAGE,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.PRODUCTS_MANAGE,
  PERMISSIONS.IMPORTS_READ,
  PERMISSIONS.IMPORTS_UPLOAD,
  PERMISSIONS.IMPORTS_CONFIRM,
  PERMISSIONS.AUDIT_READ,
  // Company admins run onboarding, so they need the pilot readiness/review
  // screen (/admin/pilot) and its GET /pilot-review/summary data.
  PERMISSIONS.PILOT_REVIEW_READ,
] as const satisfies readonly PermissionCode[];

export const ROLE_PERMISSION_MATRIX = {
  platform_owner: [
    PERMISSIONS.PLATFORM_TENANTS_READ,
    PERMISSIONS.PLATFORM_TENANTS_MANAGE,
    PERMISSIONS.PLATFORM_OPERATIONS_READ,
  ],

  // The tenant superadmin holds everything a company_admin holds plus
  // admin-management permissions — it is a strict superset, not a separate
  // role a user also needs company_admin for. See
  // docs/plans/tenant-superadmin-plan-prompt.md.
  tenant_superadmin: [
    ...COMPANY_ADMIN_PERMISSIONS,
    PERMISSIONS.ADMINS_INVITE,
    PERMISSIONS.ADMINS_MANAGE,
    // Service-level fallback only, with no screen behind either one: a fresh
    // tenant has no team_manager yet, and a potential row outlives the
    // assignment that created it — unassign the rep and nobody else could fix
    // or delete their rows. Both tables need the same repair path or the
    // asymmetry is just an oversight waiting to strand data.
    PERMISSIONS.LOCATION_ASSORTMENT_MANAGE,
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE,
    // Same kind of fallback, for the same reason: a live announcement outlives
    // the manager who published it, and a tenant between managers must still
    // be able to withdraw one that is wrong.
    PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  ],

  company_admin: COMPANY_ADMIN_PERMISSIONS,

  team_manager: [
    PERMISSIONS.LOCATIONS_READ,
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    // The manager owns the assortment standard for every outlet in the tenant,
    // the same tenant-wide reach routes.manage_team already grants.
    PERMISSIONS.LOCATION_ASSORTMENT_MANAGE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.ROUTES_READ,
    PERMISSIONS.ROUTES_MANAGE_TEAM,
    PERMISSIONS.VISITS_READ_TEAM,
    PERMISSIONS.REPORTS_READ_TEAM,
    PERMISSIONS.TASKS_READ_TEAM,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_UPDATE_TEAM,
    // The manager both publishes the notice board and reads it back: the read
    // permission is what lets the manager screen show a live announcement the
    // same way the field sees it.
    PERMISSIONS.ANNOUNCEMENTS_READ,
    PERMISSIONS.ANNOUNCEMENTS_MANAGE,
    PERMISSIONS.DASHBOARD_MANAGER_READ,
    PERMISSIONS.PILOT_REVIEW_READ,
  ],

  field_representative: [
    PERMISSIONS.LOCATIONS_READ,
    PERMISSIONS.LOCATION_INSIGHTS_READ,
    // Potential only: the representative estimates what an assigned outlet can
    // buy, but the assortment it must carry is the manager's call, so the
    // shelf-check chips in the visit report stay a read of someone else's rule.
    PERMISSIONS.LOCATION_POTENTIAL_MANAGE_OWN,
    PERMISSIONS.LOCATION_NOTES_MANAGE_OWN,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_MANAGE_OWN,
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.ROUTES_READ,
    PERMISSIONS.ROUTES_MANAGE_OWN,
    PERMISSIONS.VISITS_READ_OWN,
    PERMISSIONS.VISITS_CREATE,
    PERMISSIONS.VISITS_UPDATE_OWN,
    PERMISSIONS.VISITS_CANCEL_OWN,
    PERMISSIONS.REPORTS_READ_OWN,
    PERMISSIONS.REPORTS_CONFIRM_OWN,
    PERMISSIONS.TASKS_READ_OWN,
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_UPDATE_OWN,
    // Read-only on the notice board, and deliberately so: what is in force this
    // month is the manager's statement, not something the field edits.
    PERMISSIONS.ANNOUNCEMENTS_READ,
    PERMISSIONS.AI_USE_REPORTING,
  ],
} as const satisfies Record<AppRoleCode, readonly PermissionCode[]>;
