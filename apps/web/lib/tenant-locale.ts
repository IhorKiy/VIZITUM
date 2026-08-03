import { cache } from "react";

import { buildApiUrl } from "./api-client";

export const SUPPORTED_LOCALES = ["en", "uk"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const DEFAULT_TIME_ZONE = "UTC";

export type ResolvedTenantLocale = {
  locale: AppLocale;
  timeZone: string;
  // Tenant's ISO alpha-2 default country for phone entry; null (unknown
  // tenant, legacy tenant or API failure) means phone inputs only accept
  // "+"-international numbers.
  phoneCountry: string | null;
};

// "en" is the English marketing landing (app/en/page.tsx) and "sign-in" the
// workspace entry screen (app/sign-in/page.tsx); both are static routes, which
// shadow the [tenantSlug] route anyway — excluding them here just skips a
// doomed tenant locale lookup on every request to them.
const NON_TENANT_SEGMENTS = new Set(["platform", "api", "en", "sign-in"]);
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// Shared slug-shape check: also guards redirect paths built from
// client-supplied slugs (see lib/zone-actions.ts) against values like
// "\evil.com" that browsers would normalize into a cross-origin URL.
export function isTenantSlug(value: string): boolean {
  return TENANT_SLUG_PATTERN.test(value);
}

/**
 * The slug a URL segment names, or null when it names none.
 *
 * Trim-and-lowercase before the shape check mirrors the API's own
 * `normalizeSlug`, so a link that shouts the slug ("/MG/login") still resolves
 * the workspace instead of 404ing. Anything left over — a dot, a backslash, a
 * leading dash — is not a slug any workspace can have, and the tenant layout
 * turns that into a 404 rather than rendering the app under it.
 */
export function normalizeTenantSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();

  return isTenantSlug(normalized) ? normalized : null;
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

// How long a resolved locale may be reused across requests. Every render of
// every tenant page paid a round trip to the API for this, and no route in
// this app is static, so that was one origin request per navigation per
// reader — for two settings an admin changes about once. A minute still
// reads as immediate to the admin who just switched the language (they are
// several clicks from a tenant screen by the time it lands) while collapsing
// essentially all of that traffic.
const LOCALE_CACHE_SECONDS = 60;

// Resolves the UI locale and timezone for a request. Tenant pages (including
// pre-auth login/invite pages) follow the tenant's `language`/`timezone`
// settings; platform and root pages, unknown tenants and API failures all
// fall back to English/UTC — locale resolution must never break a page.
//
// Wrapped in React cache() so the one render that needs this twice — i18n
// resolution in i18n/request.ts and the page's own call, as on the admin
// locations and field location screens — shares a single fetch, exactly as
// resolveTenantBranding does. The slug is normalized in here rather than at
// the call sites for the same reason it is there: cache() keys on the
// argument, and i18n/request.ts passes an already-lowercased slug while pages
// pass their raw route param, so a `/ACME/...` URL would otherwise miss the
// entry and fetch twice.
export const resolveTenantLocale = cache(async function resolveTenantLocale(
  tenantSlug: string | null,
): Promise<ResolvedTenantLocale> {
  const slug = normalizeTenantSlug(tenantSlug ?? "");

  if (!slug) {
    return {
      locale: DEFAULT_LOCALE,
      timeZone: DEFAULT_TIME_ZONE,
      phoneCountry: null,
    };
  }

  try {
    const response = await fetch(
      buildApiUrl(`/tenants/${encodeURIComponent(slug)}/locale`),
      { next: { revalidate: LOCALE_CACHE_SECONDS } },
    );

    if (!response.ok) {
      return {
        locale: DEFAULT_LOCALE,
        timeZone: DEFAULT_TIME_ZONE,
        phoneCountry: null,
      };
    }

    const payload = (await response.json()) as {
      language?: unknown;
      timezone?: unknown;
      phoneCountry?: unknown;
    };

    return {
      locale: toSupportedLocale(payload.language),
      timeZone:
        typeof payload.timezone === "string" && payload.timezone
          ? payload.timezone
          : DEFAULT_TIME_ZONE,
      phoneCountry:
        typeof payload.phoneCountry === "string" && payload.phoneCountry
          ? payload.phoneCountry
          : null,
    };
  } catch {
    return {
      locale: DEFAULT_LOCALE,
      timeZone: DEFAULT_TIME_ZONE,
      phoneCountry: null,
    };
  }
});
