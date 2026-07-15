import type { Prisma } from "@prisma/client";

import { PRODUCTS_ENABLED_SETTING_KEY } from "./settings.types";

// Single home for the products_enabled TenantSetting semantics — the
// "absent row means enabled" default and the write shape — shared by the
// tenant-side SettingsService, the owner-side PlatformService and
// AuthService, so the paths can't silently drift. Plain functions (not
// service methods) so callers can pass either the root Prisma client or a
// transaction client without extra module wiring.

export function productsEnabledFromSetting(
  setting: { value: Prisma.JsonValue } | null | undefined,
): boolean {
  return setting ? setting.value === true : true;
}

// Batched read for tenant lists. Tenants without a stored setting are absent
// from the map — default them with `?? true` (productsEnabledFromSetting's
// semantics) at the call site.
export async function readProductsEnabledByTenantId(
  client: Prisma.TransactionClient,
  tenantIds: string[],
): Promise<Map<string, boolean>> {
  const settings = await client.tenantSetting.findMany({
    where: {
      tenantId: { in: tenantIds },
      key: PRODUCTS_ENABLED_SETTING_KEY,
    },
    select: { tenantId: true, value: true },
  });

  const byTenantId = new Map<string, boolean>();

  for (const setting of settings) {
    byTenantId.set(setting.tenantId, productsEnabledFromSetting(setting));
  }

  return byTenantId;
}

// `updatedByUserId` is a tenant-User FK: pass the acting tenant user's id, or
// null when the actor is not a tenant user (the platform owner).
export async function upsertProductsEnabledSetting(
  client: Prisma.TransactionClient,
  tenantId: string,
  productsEnabled: boolean,
  updatedByUserId: string | null,
): Promise<void> {
  await client.tenantSetting.upsert({
    where: {
      tenantId_key: { tenantId, key: PRODUCTS_ENABLED_SETTING_KEY },
    },
    create: {
      tenantId,
      key: PRODUCTS_ENABLED_SETTING_KEY,
      value: productsEnabled,
      updatedByUserId,
    },
    update: { value: productsEnabled, updatedByUserId },
  });
}
