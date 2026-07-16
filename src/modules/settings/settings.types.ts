import type { TenantColorScheme } from "./branding";

export const PRODUCTS_ENABLED_SETTING_KEY = "products_enabled";

// UI languages the web frontend ships dictionaries for (apps/web/messages).
// Keep in sync with SUPPORTED_LOCALES in apps/web/lib/tenant-locale.ts.
export const SUPPORTED_TENANT_LANGUAGES = ["en", "uk"] as const;

export type TenantLanguage = (typeof SUPPORTED_TENANT_LANGUAGES)[number];

export type TenantLogoResponse = {
  storageObjectId: string;
  contentType: string;
  url: string;
  urlExpiresAt: string;
};

export type TenantSettingsResponse = {
  tenantId: string;
  name: string;
  timezone: string;
  language: string;
  productMode: string;
  productsEnabled: boolean;
  colorScheme: TenantColorScheme;
  logo: TenantLogoResponse | null;
  updatedAt: string;
};

export type UpdateTenantSettingsRequestBody = {
  name?: unknown;
  timezone?: unknown;
  language?: unknown;
  productsEnabled?: unknown;
  colorScheme?: unknown;
};

export type RegisterLogoUploadRequestBody = {
  fileName?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
};

export type ConfirmLogoUploadRequestBody = {
  storageObjectId?: unknown;
};

export type RegisteredLogoUploadResponse = {
  storageObject: {
    id: string;
    bucket: string;
    objectKey: string;
    contentType: string;
    sizeBytes: string | null;
  };
  uploadUrl?: {
    url: string;
    method: "PUT";
    expiresAt: string;
    headers: Record<string, string>;
  };
};
