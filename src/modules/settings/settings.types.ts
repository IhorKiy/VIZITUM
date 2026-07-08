export const PRODUCTS_ENABLED_SETTING_KEY = "products_enabled";

// UI languages the web frontend ships dictionaries for (apps/web/messages).
// Keep in sync with SUPPORTED_LOCALES in apps/web/lib/tenant-locale.ts.
export const SUPPORTED_TENANT_LANGUAGES = ["en", "uk"] as const;

export type TenantLanguage = (typeof SUPPORTED_TENANT_LANGUAGES)[number];

export type TenantSettingsResponse = {
  tenantId: string;
  name: string;
  timezone: string;
  language: string;
  productMode: string;
  productsEnabled: boolean;
  updatedAt: string;
};

export type UpdateTenantSettingsRequestBody = {
  name?: unknown;
  timezone?: unknown;
  language?: unknown;
  productsEnabled?: unknown;
};
