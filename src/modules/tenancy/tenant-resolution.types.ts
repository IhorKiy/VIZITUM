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
};

export type PublicTenantBranding = {
  slug: string;
  colorScheme: TenantColorScheme;
  logoUrl: string | null;
};
