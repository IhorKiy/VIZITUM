export const PERMISSIONS = {
  PLATFORM_TENANTS_READ: "platform.tenants.read",
  PLATFORM_TENANTS_MANAGE: "platform.tenants.manage",
  PLATFORM_OPERATIONS_READ: "platform.operations.read",

  TENANT_SETTINGS_READ: "tenant.settings.read",
  TENANT_SETTINGS_MANAGE: "tenant.settings.manage",

  USERS_READ: "users.read",
  USERS_INVITE: "users.invite",
  USERS_MANAGE: "users.manage",
  ROLES_ASSIGN: "roles.assign",
  ADMINS_INVITE: "admins.invite",
  ADMINS_MANAGE: "admins.manage",

  LOCATIONS_READ: "locations.read",
  LOCATIONS_MANAGE: "locations.manage",
  LOCATIONS_ASSIGN: "locations.assign",

  LOCATION_INSIGHTS_READ: "location_insights.read",
  LOCATION_INSIGHTS_MANAGE: "location_insights.manage",
  LOCATION_INSIGHTS_MANAGE_OWN: "location_insights.manage_own",

  LOCATION_NOTES_MANAGE: "location_notes.manage",
  LOCATION_NOTES_MANAGE_OWN: "location_notes.manage_own",

  CONTACTS_READ: "contacts.read",
  CONTACTS_MANAGE: "contacts.manage",
  CONTACTS_MANAGE_OWN: "contacts.manage_own",

  PRODUCTS_READ: "products.read",
  PRODUCTS_MANAGE: "products.manage",

  ROUTES_READ: "routes.read",
  ROUTES_MANAGE_TEAM: "routes.manage_team",
  ROUTES_MANAGE_OWN: "routes.manage_own",

  VISITS_READ_OWN: "visits.read_own",
  VISITS_READ_TEAM: "visits.read_team",
  VISITS_CREATE: "visits.create",
  VISITS_UPDATE_OWN: "visits.update_own",
  VISITS_CANCEL_OWN: "visits.cancel_own",

  REPORTS_READ_OWN: "reports.read_own",
  REPORTS_READ_TEAM: "reports.read_team",
  REPORTS_CONFIRM_OWN: "reports.confirm_own",

  TASKS_READ_OWN: "tasks.read_own",
  TASKS_READ_TEAM: "tasks.read_team",
  TASKS_CREATE: "tasks.create",
  TASKS_UPDATE_OWN: "tasks.update_own",
  TASKS_UPDATE_TEAM: "tasks.update_team",

  IMPORTS_READ: "imports.read",
  IMPORTS_UPLOAD: "imports.upload",
  IMPORTS_CONFIRM: "imports.confirm",

  AI_USE_REPORTING: "ai.use_reporting",

  DASHBOARD_MANAGER_READ: "dashboard.manager.read",
  PILOT_REVIEW_READ: "pilot_review.read",

  AUDIT_READ: "audit.read",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];
