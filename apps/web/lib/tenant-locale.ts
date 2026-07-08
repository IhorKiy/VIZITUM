import { buildApiUrl } from "./api-client";

export const SUPPORTED_LOCALES = ["en", "uk"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const DEFAULT_TIME_ZONE = "UTC";

export type ResolvedTenantLocale = {
  locale: AppLocale;
  timeZone: string;
};

const NON_TENANT_SEGMENTS = new Set(["platform", "api"]);
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Shared slug-shape check: also guards redirect paths built from
// client-supplied slugs (see lib/zone-actions.ts) against values like
// "\evil.com" that browsers would normalize into a cross-origin URL.
export function isTenantSlug(value: string): boolean {
  return TENANT_SLUG_PATTERN.test(value);
}

export function extractTenantSlugFromPathname(pathname: string): string | null {
  const firstSegment = pathname.split("/").filter(Boolean)[0]?.toLowerCase();

  if (
    !firstSegment ||
    NON_TENANT_SEGMENTS.has(firstSegment) ||
    !isTenantSlug(firstSegment)
  ) {
    return null;
  }

  return firstSegment;
}

export function toSupportedLocale(language: unknown): AppLocale {
  return (
    SUPPORTED_LOCALES.find((locale) => locale === language) ?? DEFAULT_LOCALE
  );
}

// Resolves the UI locale and timezone for a request. Tenant pages (including
// pre-auth login/invite pages) follow the tenant's `language`/`timezone`
// settings; platform and root pages, unknown tenants and API failures all
// fall back to English/UTC — locale resolution must never break a page.
export async function resolveTenantLocale(
  tenantSlug: string | null,
): Promise<ResolvedTenantLocale> {
  if (!tenantSlug) {
    return { locale: DEFAULT_LOCALE, timeZone: DEFAULT_TIME_ZONE };
  }

  try {
    const response = await fetch(
      buildApiUrl(`/tenants/${encodeURIComponent(tenantSlug)}/locale`),
      { cache: "no-store" },
    );

    if (!response.ok) {
      return { locale: DEFAULT_LOCALE, timeZone: DEFAULT_TIME_ZONE };
    }

    const payload = (await response.json()) as {
      language?: unknown;
      timezone?: unknown;
    };

    return {
      locale: toSupportedLocale(payload.language),
      timeZone:
        typeof payload.timezone === "string" && payload.timezone
          ? payload.timezone
          : DEFAULT_TIME_ZONE,
    };
  } catch {
    return { locale: DEFAULT_LOCALE, timeZone: DEFAULT_TIME_ZONE };
  }
}
