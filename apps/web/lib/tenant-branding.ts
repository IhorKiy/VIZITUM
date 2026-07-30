import { cache } from "react";

import { buildApiUrl } from "./api-client";
import {
  DEFAULT_COLOR_SCHEME,
  toColorScheme,
  type TenantColorScheme,
} from "./branding";
import { tenantDisplayName } from "./navigation";
import { isTenantSlug } from "./tenant-locale";

export type ResolvedTenantBranding = {
  // Ready to render as-is: the stored tenant name, or the slug-derived
  // approximation when the lookup failed (see tenantDisplayName).
  name: string;
  colorScheme: TenantColorScheme;
  logoUrl: string | null;
};

const defaultBranding = (
  tenantSlug: string | null,
): ResolvedTenantBranding => ({
  name: tenantSlug ? tenantDisplayName(null, tenantSlug) : "",
  colorScheme: DEFAULT_COLOR_SCHEME,
  logoUrl: null,
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
    const normalized = tenantSlug?.trim().toLowerCase() ?? "";
    const slug = isTenantSlug(normalized) ? normalized : null;

    if (!slug) {
      return defaultBranding(slug);
    }

    try {
      const response = await fetch(
        buildApiUrl(`/tenants/${encodeURIComponent(slug)}/branding`),
        { cache: "no-store" },
      );

      if (!response.ok) {
        return defaultBranding(slug);
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
      };
    } catch {
      return defaultBranding(slug);
    }
  },
);
