import type { PlatformTenant } from "@prisma/client";

import type { TenantColorScheme } from "../settings/branding";

export type TenantResolutionInput = {
  host?: string;
  path?: string;
};

export type TenantResolutionResult = {
  tenant: PlatformTenant;
  slug: string;
};

export type PublicTenantLocale = {
  slug: string;
  language: string;
  timezone: string;
  // ISO 3166-1 alpha-2 default country for phone entry; null means only
  // "+"-prefixed international input is accepted for this tenant.
  phoneCountry: string | null;
};

export type PublicTenantBranding = {
  slug: string;
  // The tenant name exactly as it was entered at creation, case included. The
  // frontend renders this verbatim: a workspace named "MG" must not show up as
  // "Mg", which is what deriving the name from the (lowercase) slug produced.
  name: string;
  colorScheme: TenantColorScheme;
  logoUrl: string | null;
};
