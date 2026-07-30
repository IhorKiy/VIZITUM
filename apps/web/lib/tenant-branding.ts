import { cache } from "react";

import { buildApiUrl } from "./api-client";
import {
  DEFAULT_COLOR_SCHEME,
  toColorScheme,
  type TenantColorScheme,
} from "./branding";
import { tenantDisplayName } from "./navigation";

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
export const resolveTenantBranding = cache(
  async (tenantSlug: string | null): Promise<ResolvedTenantBranding> => {
    if (!tenantSlug) {
      return defaultBranding(tenantSlug);
    }

    try {
      const response = await fetch(
        buildApiUrl(`/tenants/${encodeURIComponent(tenantSlug)}/branding`),
        { cache: "no-store" },
      );

      if (!response.ok) {
        return defaultBranding(tenantSlug);
      }

      const payload = (await response.json()) as {
        name?: unknown;
        colorScheme?: unknown;
        logoUrl?: unknown;
      };

      return {
        name: tenantDisplayName(
          typeof payload.name === "string" ? payload.name : null,
          tenantSlug,
        ),
        colorScheme: toColorScheme(payload.colorScheme),
        logoUrl:
          typeof payload.logoUrl === "string" && payload.logoUrl
            ? payload.logoUrl
            : null,
      };
    } catch {
      return defaultBranding(tenantSlug);
    }
  },
);
