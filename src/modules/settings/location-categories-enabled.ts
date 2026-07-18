import type { Prisma } from "@prisma/client";

import { LOCATION_CATEGORIES_ENABLED_SETTING_KEY } from "./settings.types";

// Single home for the location_categories_enabled TenantSetting semantics —
// the "absent row means enabled" default and the write shape — mirroring
// products-enabled.ts. Unlike products_enabled, this toggle is tenant-admin
// managed only (no platform-owner path), so there is no batched
// read-by-tenant-ids helper here.

export function locationCategoriesEnabledFromSetting(
  setting: { value: Prisma.JsonValue } | null | undefined,
): boolean {
  return setting ? setting.value === true : true;
}

// `updatedByUserId` is a tenant-User FK: pass the acting tenant user's id, or
// null when the actor is not a tenant user.
export async function upsertLocationCategoriesEnabledSetting(
  client: Prisma.TransactionClient,
  tenantId: string,
  locationCategoriesEnabled: boolean,
  updatedByUserId: string | null,
): Promise<void> {
  await client.tenantSetting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key: LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
      },
    },
    create: {
      tenantId,
      key: LOCATION_CATEGORIES_ENABLED_SETTING_KEY,
      value: locationCategoriesEnabled,
      updatedByUserId,
    },
    update: { value: locationCategoriesEnabled, updatedByUserId },
  });
}
