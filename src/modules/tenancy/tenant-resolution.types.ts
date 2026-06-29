import type { PlatformTenant } from "@prisma/client";

export type TenantResolutionInput = {
  host?: string;
  path?: string;
};

export type TenantResolutionResult = {
  tenant: PlatformTenant;
  slug: string;
};
