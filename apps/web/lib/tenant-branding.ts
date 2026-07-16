import { cache } from "react";

import { buildApiUrl } from "./api-client";
import {
  DEFAULT_COLOR_SCHEME,
  toColorScheme,
  type TenantColorScheme,
} from "./branding";

export type ResolvedTenantBranding = {
  colorScheme: TenantColorScheme;
  logoUrl: string | null;
};

const DEFAULT_BRANDING: ResolvedTenantBranding = {
  colorScheme: DEFAULT_COLOR_SCHEME,
  logoUrl: null,
};

// Resolves the tenant's branding (color scheme + logo URL) for a request via
// the public pre-auth endpoint, mirroring resolveTenantLocale: unknown
// tenants and API failures fall back to the default branding — branding
// resolution must never break a page. Wrapped in React cache() so the tenant
// layout, AppShell and login page share one fetch per request.
export const resolveTenantBranding = cache(
  async (tenantSlug: string | null): Promise<ResolvedTenantBranding> => {
    if (!tenantSlug) {
      return DEFAULT_BRANDING;
    }

    try {
      const response = await fetch(
        buildApiUrl(`/tenants/${encodeURIComponent(tenantSlug)}/branding`),
        { cache: "no-store" },
      );

      if (!response.ok) {
        return DEFAULT_BRANDING;
      }

      const payload = (await response.json()) as {
        colorScheme?: unknown;
        logoUrl?: unknown;
      };

      return {
        colorScheme: toColorScheme(payload.colorScheme),
        logoUrl:
          typeof payload.logoUrl === "string" && payload.logoUrl
            ? payload.logoUrl
            : null,
      };
    } catch {
      return DEFAULT_BRANDING;
    }
  },
);
