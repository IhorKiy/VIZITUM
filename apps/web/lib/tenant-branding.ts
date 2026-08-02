import { cache } from "react";

import { buildApiUrl } from "./api-client";
import {
  DEFAULT_COLOR_SCHEME,
  toColorScheme,
  type TenantColorScheme,
} from "./branding";
import { tenantDisplayName } from "./navigation";
import { normalizeTenantSlug } from "./tenant-locale";

// Whether the workspace behind this slug exists at all. "missing" is only
// ever a 404 from the endpoint — which does no status gating, so a suspended
// or archived workspace still answers "found" — while a network failure, a
// 5xx or a slug that is not even slug-shaped stay separable from it. A caller
// that refuses to render on "missing" (the login page, the tenant manifest)
// must not do the same on "unknown": telling everyone their workspace no
// longer exists is the wrong way to report that the API is down.
export type TenantExistence = "found" | "missing" | "unknown";

export type ResolvedTenantBranding = {
  // Ready to render as-is: the stored tenant name, or the slug-derived
  // approximation when the lookup failed (see tenantDisplayName).
  name: string;
  colorScheme: TenantColorScheme;
  logoUrl: string | null;
  existence: TenantExistence;
};

const defaultBranding = (
  tenantSlug: string | null,
  existence: TenantExistence,
): ResolvedTenantBranding => ({
  name: tenantSlug ? tenantDisplayName(null, tenantSlug) : "",
  colorScheme: DEFAULT_COLOR_SCHEME,
  logoUrl: null,
  existence,
});

// Resolves the tenant's branding (name + color scheme + logo URL) for a
// request via the public pre-auth endpoint, mirroring resolveTenantLocale:
// unknown tenants and API failures fall back to the default branding —
// branding resolution must never break a page. Wrapped in React cache() so the
// tenant layout, AppShell and the pre-auth pages share one fetch per request.
//
// The slug check lives in here rather than at the call sites on purpose:
// cache() keys on the argument, so a caller that pre-filtered its slug to null
// would miss the entry a caller passing the raw slug created, and the request
// would fetch twice. Trim-and-lowercase mirrors the endpoint's own
// normalizeSlug, so a link that shouts the slug ("/MG/login") still resolves
// the workspace instead of rendering an unbranded, unnamed panel.
export const resolveTenantBranding = cache(
  async (tenantSlug: string | null): Promise<ResolvedTenantBranding> => {
    const slug = normalizeTenantSlug(tenantSlug ?? "");

    if (!slug) {
      // Nothing slug-shaped can name a workspace, so this needs no round trip
      // to be certain about — normalizeSlug on the API side would reject it
      // the same way.
      return defaultBranding(slug, "missing");
    }

    try {
      const response = await fetch(
        buildApiUrl(`/tenants/${encodeURIComponent(slug)}/branding`),
        { cache: "no-store" },
      );

      if (!response.ok) {
        return defaultBranding(
          slug,
          response.status === 404 ? "missing" : "unknown",
        );
      }

      const payload = (await response.json()) as {
        name?: unknown;
        colorScheme?: unknown;
        logoUrl?: unknown;
      };

      return {
        name: tenantDisplayName(
          typeof payload.name === "string" ? payload.name : null,
          slug,
        ),
        colorScheme: toColorScheme(payload.colorScheme),
        logoUrl:
          typeof payload.logoUrl === "string" && payload.logoUrl
            ? payload.logoUrl
            : null,
        existence: "found",
      };
    } catch {
      return defaultBranding(slug, "unknown");
    }
  },
);
