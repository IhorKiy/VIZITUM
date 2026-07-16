import { Prisma } from "@prisma/client";

// Single home for the tenant branding TenantSetting semantics — the color
// scheme (one of four fixed presets) and the logo StorageObject pointer —
// shared by the tenant-side SettingsService and the public tenancy branding
// endpoint, so the paths can't silently drift. Plain functions (not service
// methods) so callers can pass either the root Prisma client or a
// transaction client without extra module wiring.

export const BRANDING_COLOR_SCHEME_SETTING_KEY = "branding_color_scheme";
export const BRANDING_LOGO_OBJECT_SETTING_KEY = "branding_logo_object_id";

// Scheme ids only — the CSS variable values for each scheme live in
// apps/web/lib/branding.ts. Keep both lists in sync (same pattern as
// SUPPORTED_TENANT_LANGUAGES <-> SUPPORTED_LOCALES; pinned by
// tests/branding-scheme-mirror.test.ts).
export const TENANT_COLOR_SCHEMES = [
  "emerald",
  "indigo",
  "plum",
  "terracotta",
] as const;

export type TenantColorScheme = (typeof TENANT_COLOR_SCHEMES)[number];

export const DEFAULT_COLOR_SCHEME: TenantColorScheme = "emerald";

export function colorSchemeFromSetting(
  setting: { value: Prisma.JsonValue } | null | undefined,
): TenantColorScheme {
  return (
    TENANT_COLOR_SCHEMES.find((scheme) => scheme === setting?.value) ??
    DEFAULT_COLOR_SCHEME
  );
}

export function normalizeColorScheme(
  value: unknown,
): TenantColorScheme | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return TENANT_COLOR_SCHEMES.find((scheme) => scheme === normalized) ?? null;
}

export type TenantBrandingSettings = {
  colorScheme: TenantColorScheme;
  logoObjectId: string | null;
};

export async function readBrandingSettings(
  client: Prisma.TransactionClient,
  tenantId: string,
): Promise<TenantBrandingSettings> {
  const settings = await client.tenantSetting.findMany({
    where: {
      tenantId,
      key: {
        in: [
          BRANDING_COLOR_SCHEME_SETTING_KEY,
          BRANDING_LOGO_OBJECT_SETTING_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });

  const byKey = new Map(settings.map((setting) => [setting.key, setting]));

  return {
    colorScheme: colorSchemeFromSetting(
      byKey.get(BRANDING_COLOR_SCHEME_SETTING_KEY),
    ),
    logoObjectId: logoObjectIdFromSetting(
      byKey.get(BRANDING_LOGO_OBJECT_SETTING_KEY),
    ),
  };
}

export function logoObjectIdFromSetting(
  setting: { value: Prisma.JsonValue } | null | undefined,
): string | null {
  return typeof setting?.value === "string" && setting.value
    ? setting.value
    : null;
}

// `updatedByUserId` is a tenant-User FK: pass the acting tenant user's id, or
// null when the actor is not a tenant user.
export async function upsertColorSchemeSetting(
  client: Prisma.TransactionClient,
  tenantId: string,
  colorScheme: TenantColorScheme,
  updatedByUserId: string | null,
): Promise<void> {
  await client.tenantSetting.upsert({
    where: {
      tenantId_key: { tenantId, key: BRANDING_COLOR_SCHEME_SETTING_KEY },
    },
    create: {
      tenantId,
      key: BRANDING_COLOR_SCHEME_SETTING_KEY,
      value: colorScheme,
      updatedByUserId,
    },
    update: { value: colorScheme, updatedByUserId },
  });
}

// Clearing the logo stores a JSON null value (rather than deleting the row)
// so the read side has one shape; logoObjectIdFromSetting treats any
// non-string value as "no logo".
export async function setLogoObjectSetting(
  client: Prisma.TransactionClient,
  tenantId: string,
  logoObjectId: string | null,
  updatedByUserId: string | null,
): Promise<void> {
  const value = logoObjectId ?? Prisma.JsonNull;

  await client.tenantSetting.upsert({
    where: {
      tenantId_key: { tenantId, key: BRANDING_LOGO_OBJECT_SETTING_KEY },
    },
    create: {
      tenantId,
      key: BRANDING_LOGO_OBJECT_SETTING_KEY,
      value,
      updatedByUserId,
    },
    update: { value, updatedByUserId },
  });
}
