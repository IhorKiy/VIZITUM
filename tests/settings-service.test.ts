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
  language: "uk",
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
        findMany: async () => [],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.name, "Acme Distribution");
    assert.equal(settings.timezone, "Europe/Kyiv");
    assert.equal(settings.language, "uk");
    assert.equal(settings.productsEnabled, true);
  });

  it("reads a persisted productsEnabled=false setting", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [{ key: "products_enabled", value: false }],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.productsEnabled, false);
  });

  it("defaults locationCategoriesEnabled to true when unset", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.locationCategoriesEnabled, true);
  });

  it("reads a persisted locationCategoriesEnabled=false setting", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [
          { key: "location_categories_enabled", value: false },
        ],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.locationCategoriesEnabled, false);
  });

  it("persists name, timezone and productsEnabled together in one transaction", async () => {
    const tenantUpdates: unknown[] = [];
    const settingUpserts: unknown[] = [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [{ key: "products_enabled", value: false }],
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
        findMany: async () => [],
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

  it("persists a supported language (normalized to lowercase)", async () => {
    const tenantUpdates: unknown[] = [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [],
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
      language: " EN ",
    });

    assert.equal(
      (tenantUpdates[0] as { data: { language: string } }).data.language,
      "en",
    );
  });

  it("rejects an unsupported language", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          language: "de",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "SETTINGS_INVALID",
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

  it("rejects a non-boolean locationCategoriesEnabled value", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          locationCategoriesEnabled: "yes" as unknown as boolean,
        }),
      (error: { response?: { code?: string; fieldErrors?: unknown } }) =>
        error.response?.code === "SETTINGS_INVALID" &&
        Boolean(
          (
            error.response?.fieldErrors as
              | { locationCategoriesEnabled?: string[] }
              | undefined
          )?.locationCategoriesEnabled,
        ),
    );
  });

  it("persists locationCategoriesEnabled via the settings transaction", async () => {
    const settingUpserts: { where?: { tenantId_key?: { key?: string }} }[] =
      [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
        update: async () => undefined,
      },
      tenantSetting: {
        // Simulates the state a fresh read would see after the upsert below
        // has been applied — the mock is static, so this stands in for "the
        // DB now reflects locationCategoriesEnabled: false".
        findMany: async () => [
          { key: "location_categories_enabled", value: false },
        ],
      },
      $transaction: async (
        callback: (tx: {
          platformTenant: { update: (query: unknown) => Promise<void> };
          tenantSetting: { upsert: (query: unknown) => Promise<void> };
        }) => Promise<void>,
      ) =>
        callback({
          platformTenant: {
            update: async () => undefined,
          },
          tenantSetting: {
            upsert: async (query: unknown) => {
              settingUpserts.push(query as never);
            },
          },
        }),
    } as never);

    const settings = await service.updateSettings(context as never, {
      locationCategoriesEnabled: false,
    });

    assert.equal(settings.locationCategoriesEnabled, false);
    assert.equal(settingUpserts.length, 1);
    assert.equal(
      settingUpserts[0].where?.tenantId_key?.key,
      "location_categories_enabled",
    );
  });

  it("defaults colorScheme to emerald and logo to null when nothing is stored", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.colorScheme, "emerald");
    assert.equal(settings.logo, null);
  });

  it("returns a persisted color scheme", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [
          { key: "branding_color_scheme", value: "plum" },
        ],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.colorScheme, "plum");
  });

  it("falls back to emerald for an unrecognized stored color scheme", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
      tenantSetting: {
        findMany: async () => [
          { key: "branding_color_scheme", value: "hotpink" },
        ],
      },
    } as never);

    const settings = await service.getSettings(context as never);

    assert.equal(settings.colorScheme, "emerald");
  });

  it("persists a color scheme via the settings transaction", async () => {
    const settingUpserts: { where?: { tenantId_key?: { key?: string } } }[] =
      [];
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
        update: async () => undefined,
      },
      tenantSetting: {
        findMany: async () => [
          { key: "branding_color_scheme", value: "indigo" },
        ],
      },
      $transaction: async (
        callback: (tx: {
          platformTenant: { update: (query: unknown) => Promise<void> };
          tenantSetting: { upsert: (query: unknown) => Promise<void> };
        }) => Promise<void>,
      ) =>
        callback({
          platformTenant: {
            update: async () => undefined,
          },
          tenantSetting: {
            upsert: async (query: unknown) => {
              settingUpserts.push(query as never);
            },
          },
        }),
    } as never);

    const settings = await service.updateSettings(context as never, {
      colorScheme: "indigo",
    });

    assert.equal(settings.colorScheme, "indigo");
    assert.equal(settingUpserts.length, 1);
    assert.equal(
      settingUpserts[0].where?.tenantId_key?.key,
      "branding_color_scheme",
    );
  });

  it("rejects a color scheme outside the four presets", async () => {
    const service = new SettingsService({
      platformTenant: {
        findUniqueOrThrow: async () => baseTenant,
      },
    } as never);

    await assert.rejects(
      () =>
        service.updateSettings(context as never, {
          colorScheme: "hotpink",
        }),
      (error: {
        response?: { code?: string; fieldErrors?: { colorScheme?: string[] } };
      }) =>
        error.response?.code === "SETTINGS_INVALID" &&
        (error.response?.fieldErrors?.colorScheme?.length ?? 0) > 0,
    );
  });

  it("returns logo null when the pointer references a missing or inactive object", async () => {
    const service = new SettingsService(
      {
        platformTenant: {
          findUniqueOrThrow: async () => baseTenant,
        },
        tenantSetting: {
          findMany: async () => [
            { key: "branding_logo_object_id", value: "object-gone" },
          ],
        },
        storageObject: {
          findFirst: async () => null,
        },
      } as never,
      {
        getDefaultBucket: () => "vizitum",
        createPresignedDownloadUrl: async () => {
          throw new Error("should not be called for a missing object");
        },
      } as never,
    );

    const settings = await service.getSettings(context as never);

    assert.equal(settings.logo, null);
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
