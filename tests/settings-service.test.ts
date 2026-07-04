import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { ROLE_PERMISSION_MATRIX } from "../src/modules/roles/role-permission.matrix";
import { SettingsService } from "../src/modules/settings/settings.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

const baseTenant = {
  id: "tenant-a",
  name: "Acme Distribution",
  timezone: "Europe/Kyiv",
  productMode: "team",
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

describe("settings service", () => {
  it("returns tenant name, timezone and defaults productsEnabled to true when unset", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findUnique: async () => null,
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.name, "Acme Distribution");
    assert.equal(settings.timezone, "Europe/Kyiv");
    assert.equal(settings.productsEnabled, true);
  });

  it("reads a persisted productsEnabled=false setting", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findUnique: async () => ({ value: false }),
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.productsEnabled, false);
  });

  it("persists name, timezone and productsEnabled together in one transaction", async () => {
    const tenantUpdates: unknown[] = [];
    const settingUpserts: unknown[] = [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findUnique: async () => ({ value: false }),
      },
      $transaction: async (
        callback: (tx: {
          platformTenant: { update: (query: unknown) => Promise<void> };
          tenantSetting: { upsert: (query: unknown) => Promise<void> };
        }) => Promise<void>,
      ) =>
        callback({
          platformTenant: {
            update: async (query: unknown) => {
              tenantUpdates.push(query);
            },
          },
          tenantSetting: {
            upsert: async (query: unknown) => {
              settingUpserts.push(query);
            },
          },
        }),
    } as never);

    await service.updateSettings(context as never, {
      name: "New Company Name",
      timezone: "America/New_York",
      productsEnabled: true,
    });

    assert.deepEqual(tenantUpdates, [
      {
        where: { id: "tenant-a" },
        data: { name: "New Company Name", timezone: "America/New_York" },
      },
    ]);
    assert.equal(settingUpserts.length, 1);
    assert.equal(
      (settingUpserts[0] as { create: { value: boolean } }).create.value,
      true,
    );
  });

  it("rejects a timezone that is not a real IANA time zone", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          timezone: "Not/A_Real_Zone",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "SETTINGS_INVALID",
    );
  });

  it("accepts a valid IANA time zone", async () => {
    const tenantUpdates: unknown[] = [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findUnique: async () => null,
      },
      $transaction: async (
        callback: (tx: {
          platformTenant: { update: (query: unknown) => Promise<void> };
        }) => Promise<void>,
      ) =>
        callback({
          platformTenant: {
            update: async (query: unknown) => {
              tenantUpdates.push(query);
            },
          },
        }),
    } as never);

    await service.updateSettings(context as never, {
      timezone: "Asia/Tokyo",
    });

    assert.equal(
      (tenantUpdates[0] as { data: { timezone: string } }).data.timezone,
      "Asia/Tokyo",
    );
  });

  it("rejects an empty company name", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          name: "   ",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "SETTINGS_INVALID",
    );
  });

  it("rejects a company name longer than 200 characters", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          name: "a".repeat(201),
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "SETTINGS_INVALID",
    );
  });

  it("rejects a non-boolean productsEnabled value", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          productsEnabled: "yes" as unknown as boolean,
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "SETTINGS_INVALID",
    );
  });

  it("grants tenant settings permissions only to company_admin", () => {
    assert.equal(PERMISSIONS.TENANT_SETTINGS_READ, "tenant.settings.read");
    assert.equal(PERMISSIONS.TENANT_SETTINGS_MANAGE, "tenant.settings.manage");
    assert.ok(
      ROLE_PERMISSION_MATRIX.company_admin.includes(
        PERMISSIONS.TENANT_SETTINGS_MANAGE,
      ),
    );
    assert.ok(
      !ROLE_PERMISSION_MATRIX.team_manager.includes(
        PERMISSIONS.TENANT_SETTINGS_MANAGE,
      ),
    );
    assert.ok(
      !ROLE_PERMISSION_MATRIX.field_representative.includes(
        PERMISSIONS.TENANT_SETTINGS_MANAGE,
      ),
    );
  });
});
