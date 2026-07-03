export const PRODUCTS_ENABLED_SETTING_KEY = "products_enabled";

export type TenantSettingsResponse = {
  tenantId: string;
  name: string;
  timezone: string;
  productMode: string;
  productsEnabled: boolean;
  updatedAt: string;
};

export type UpdateTenantSettingsRequestBody = {
  name?: unknown;
  timezone?: unknown;
  productsEnabled?: unknown;
};
