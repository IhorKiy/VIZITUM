export const PRODUCT_CAPABILITIES = {
  TEAM_BASIC_ROLES: "team.basic_roles",
  TEAM_FIXED_IMPORTS: "team.fixed_imports",
  TEAM_MANAGER_FULL_TENANT_VIEW: "team.manager.full_tenant_view",
  TEAM_FIELD_DAILY_FLOW: "team.field.daily_flow",
  AI_REPORTING: "ai.reporting",
} as const;

export type ProductCapabilityCode =
  (typeof PRODUCT_CAPABILITIES)[keyof typeof PRODUCT_CAPABILITIES];

export const TEAM_MODE_CAPABILITIES = [
  PRODUCT_CAPABILITIES.TEAM_BASIC_ROLES,
  PRODUCT_CAPABILITIES.TEAM_FIXED_IMPORTS,
  PRODUCT_CAPABILITIES.TEAM_MANAGER_FULL_TENANT_VIEW,
  PRODUCT_CAPABILITIES.TEAM_FIELD_DAILY_FLOW,
  PRODUCT_CAPABILITIES.AI_REPORTING,
] as const satisfies readonly ProductCapabilityCode[];
