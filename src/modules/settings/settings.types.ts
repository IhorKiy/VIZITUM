import type { TenantColorScheme } from "./branding";

export const PRODUCTS_ENABLED_SETTING_KEY = "products_enabled";
export const LOCATION_CATEGORIES_ENABLED_SETTING_KEY =
  "location_categories_enabled";
export const FIELD_REPORT_VOICE_HINT_SETTING_KEY = "field_report_voice_hint";

// UI languages the web frontend ships dictionaries for (apps/web/messages).
// Keep in sync with SUPPORTED_LOCALES in apps/web/lib/tenant-locale.ts.
export const SUPPORTED_TENANT_LANGUAGES = ["en", "uk"] as const;

export type TenantLanguage = (typeof SUPPORTED_TENANT_LANGUAGES)[number];

// The tenant's own display name, which is wider than TEXT_LIMITS.name (120):
// it names a company rather than a person, and tenants created before this
// endpoint existed may already carry a longer one. Declared here rather than
// inside settings.service.ts so the class-validator DTO in front of
// `PATCH /admin/settings` can import the same number instead of restating it —
// a DTO importing a Nest service module would be the wrong direction of
// dependency for a value neither layer owns more than the other.
export const MAX_TENANT_NAME_LENGTH = 200;

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
  locationCategoriesEnabled: boolean;
  colorScheme: TenantColorScheme;
  logo: TenantLogoResponse | null;
  fieldReportVoiceHint: string | null;
  updatedAt: string;
};

export type FieldReportVoiceHintResponse = {
  voiceHint: string | null;
};

export type UpdateTenantSettingsRequestBody = {
  name?: unknown;
  timezone?: unknown;
  language?: unknown;
  productsEnabled?: unknown;
  locationCategoriesEnabled?: unknown;
  colorScheme?: unknown;
  fieldReportVoiceHint?: unknown;
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
