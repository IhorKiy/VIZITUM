import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SettingsService } from "../src/modules/settings/settings.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: ["tenant.settings.read", "tenant.settings.manage"],
};

const baseTenant = {
  id: "tenant-a",
  name: "Acme Distribution",
  timezone: "Europe/Kyiv",
  language: "uk",
  productMode: "team",
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

type FakeStorageObjectRow = {
  id: string;
  tenantId: string;
  bucket: string;
  objectKey: string;
  purpose: string;
  contentType: string;
  sizeBytes: bigint | null;
  status: string;
  createdByUserId: string | null;
};

function buildService(options?: {
  settingRows?: { key: string; value: unknown }[];
  storageRows?: FakeStorageObjectRow[];
}) {
  const settingRows = options?.settingRows ?? [];
  const storageRows = options?.storageRows ?? [];
  const created: FakeStorageObjectRow[] = [];
  const updateManyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const settingUpserts: {
    where: { tenantId_key: { key: string } };
    create: { value: unknown };
    update: { value: unknown };
  }[] = [];
  const deletedRemoteKeys: string[] = [];
  const presignedUploads: string[] = [];

  const storageObjectDelegate = {
    findMany: async (query: {
      where: { id?: { not?: string }; status?: string };
    }) =>
      storageRows.filter(
        (row) =>
          row.purpose === "branding_logo" &&
          row.status === "active" &&
          (!query.where.id?.not || row.id !== query.where.id.not),
      ),
    findFirst: async (query: {
      where: {
        id: string;
        purpose?: string;
        status?: string | { not: string };
      };
    }) =>
      [...storageRows, ...created].find(
        (row) =>
          row.id === query.where.id &&
          row.tenantId === "tenant-a" &&
          (!query.where.purpose || row.purpose === query.where.purpose) &&
          (typeof query.where.status !== "string" ||
            row.status === query.where.status) &&
          (typeof query.where.status !== "object" ||
            row.status !== query.where.status.not),
      ) ?? null,
    updateMany: async (query: unknown) => {
      updateManyCalls.push(query);
    },
    update: async (query: unknown) => {
      updateCalls.push(query);
    },
    create: async (query: { data: Omit<FakeStorageObjectRow, "id"> }) => {
      const row = { id: `object-${created.length + 1}`, ...query.data };
      created.push(row as FakeStorageObjectRow);
      return row;
    },
  };

  const tenantSettingDelegate = {
    findMany: async () => settingRows,
    findUnique: async (query: { where: { tenantId_key: { key: string } } }) =>
      settingRows.find((row) => row.key === query.where.tenantId_key.key) ??
      null,
    upsert: async (query: (typeof settingUpserts)[number]) => {
      settingUpserts.push(query);
    },
  };

  const prisma = {
    platformTenant: { findUniqueOrThrow: async () => baseTenant },
    tenantSetting: tenantSettingDelegate,
    storageObject: storageObjectDelegate,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        storageObject: storageObjectDelegate,
        tenantSetting: tenantSettingDelegate,
        platformTenant: { update: async () => undefined },
      }),
  };

  const storageService = {
    getDefaultBucket: () => "vizitum",
    createPresignedUploadUrl: async (_context: unknown, id: string) => {
      presignedUploads.push(id);
      return {
        url: `https://r2.example/upload/${id}`,
        method: "PUT",
        expiresAt: "2026-07-16T00:05:00.000Z",
        headers: { "content-type": "image/png" },
      };
    },
    createPresignedDownloadUrl: async (_context: unknown, id: string) => ({
      url: `https://r2.example/download/${id}`,
      method: "GET",
      expiresAt: "2026-07-16T00:05:00.000Z",
      headers: {},
    }),
  };

  const s3Storage = {
    deleteObject: async (_bucket: string, objectKey: string) => {
      deletedRemoteKeys.push(objectKey);
    },
  };

  const service = new SettingsService(
    prisma as never,
    storageService as never,
    s3Storage as never,
  );

  return {
    service,
    created,
    updateManyCalls,
    updateCalls,
    settingUpserts,
    deletedRemoteKeys,
    presignedUploads,
  };
}

describe("branding logo upload", () => {
  it("rejects a register call without a usable file name", async () => {
    const { service } = buildService();

    await assert.rejects(
      () =>
        service.registerLogoUpload(context as never, {
          fileName: "   ",
          contentType: "image/png",
          sizeBytes: 2048,
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "BRANDING_LOGO_INVALID",
    );
  });

  it("rejects an unsupported content type with no recognizable extension", async () => {
    const { service } = buildService();

    await assert.rejects(
      () =>
        service.registerLogoUpload(context as never, {
          fileName: "logo.gif",
          contentType: "image/gif",
          sizeBytes: 2048,
        }),
      (error: {
        response?: { code?: string; fieldErrors?: { contentType?: string[] } };
      }) =>
        error.response?.code === "BRANDING_LOGO_INVALID" &&
        (error.response?.fieldErrors?.contentType?.length ?? 0) > 0,
    );
  });

  it("rejects a register call with no declared size", async () => {
    // Required, not optional: the presigned PUT signs this as Content-Length,
    // so a registration without one would mean signing an unbounded upload.
    const { service } = buildService();

    await assert.rejects(
      () =>
        service.registerLogoUpload(context as never, {
          fileName: "logo.png",
          contentType: "image/png",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "BRANDING_LOGO_SIZE_INVALID",
    );
  });

  it("rejects a logo larger than 1 MB", async () => {
    const { service } = buildService();

    await assert.rejects(
      () =>
        service.registerLogoUpload(context as never, {
          fileName: "logo.png",
          contentType: "image/png",
          sizeBytes: 1024 * 1024 + 1,
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "BRANDING_LOGO_SIZE_INVALID",
    );
  });

  it("derives the content type from the file extension when the mime is missing", async () => {
    const { service, created } = buildService();

    const result = await service.registerLogoUpload(context as never, {
      fileName: "brand.svg",
      sizeBytes: 2048,
    });

    assert.equal(result.storageObject.contentType, "image/svg+xml");
    assert.equal(created[0].contentType, "image/svg+xml");
  });

  it("creates a persistent branding_logo object and returns a presigned upload", async () => {
    const { service, created, presignedUploads } = buildService();

    const result = await service.registerLogoUpload(context as never, {
      fileName: "logo.png",
      contentType: "image/png",
      sizeBytes: 2048,
    });

    assert.equal(created.length, 1);
    assert.equal(created[0].purpose, "branding_logo");
    assert.equal(created[0].status, "active");
    assert.ok(!("expiresAt" in created[0]));
    assert.match(
      created[0].objectKey,
      /^tenants\/tenant-a\/branding\/logo\/[0-9a-f-]+\/logo\.png$/,
    );
    assert.equal(result.uploadUrl?.method, "PUT");
    assert.deepEqual(presignedUploads, [created[0].id]);
  });

  it("sweeps abandoned branding objects on register but keeps the current logo", async () => {
    const { service, updateManyCalls, deletedRemoteKeys } = buildService({
      settingRows: [
        { key: "branding_logo_object_id", value: "object-current" },
      ],
      storageRows: [
        {
          id: "object-current",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/branding/logo/current/logo.png",
          purpose: "branding_logo",
          contentType: "image/png",
          sizeBytes: null,
          status: "active",
          createdByUserId: "user-a",
        },
        {
          id: "object-abandoned",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/branding/logo/abandoned/logo.png",
          purpose: "branding_logo",
          contentType: "image/png",
          sizeBytes: null,
          status: "active",
          createdByUserId: "user-a",
        },
      ],
    });

    await service.registerLogoUpload(context as never, {
      fileName: "logo.png",
      contentType: "image/png",
      sizeBytes: 2048,
    });

    assert.equal(updateManyCalls.length, 1);
    assert.deepEqual(
      (updateManyCalls[0] as { where: { id: { in: string[] } } }).where.id.in,
      ["object-abandoned"],
    );
    assert.deepEqual(deletedRemoteKeys, [
      "tenants/tenant-a/branding/logo/abandoned/logo.png",
    ]);
  });

  it("rejects confirming an object that is not an active branding logo", async () => {
    const { service } = buildService({
      storageRows: [
        {
          id: "object-import",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/imports/file.csv",
          purpose: "import_file",
          contentType: "text/csv",
          sizeBytes: null,
          status: "active",
          createdByUserId: "user-a",
        },
      ],
    });

    await assert.rejects(
      () =>
        service.confirmLogoUpload(context as never, {
          storageObjectId: "object-import",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "BRANDING_LOGO_INVALID",
    );

    await assert.rejects(
      () =>
        service.confirmLogoUpload(context as never, {
          storageObjectId: "object-unknown",
        }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "STORAGE_OBJECT_NOT_FOUND",
    );
  });

  it("confirm swaps the logo pointer and deletes the previous object", async () => {
    const { service, settingUpserts, deletedRemoteKeys, updateCalls } =
      buildService({
        settingRows: [
          { key: "branding_logo_object_id", value: "object-old" },
        ],
        storageRows: [
          {
            id: "object-old",
            tenantId: "tenant-a",
            bucket: "vizitum",
            objectKey: "tenants/tenant-a/branding/logo/old/logo.png",
            purpose: "branding_logo",
            contentType: "image/png",
            sizeBytes: null,
            status: "active",
            createdByUserId: "user-a",
          },
          {
            id: "object-new",
            tenantId: "tenant-a",
            bucket: "vizitum",
            objectKey: "tenants/tenant-a/branding/logo/new/logo.png",
            purpose: "branding_logo",
            contentType: "image/png",
            sizeBytes: null,
            status: "active",
            createdByUserId: "user-a",
          },
        ],
      });

    await service.confirmLogoUpload(context as never, {
      storageObjectId: "object-new",
    });

    const pointerUpsert = settingUpserts.find(
      (upsert) =>
        upsert.where.tenantId_key.key === "branding_logo_object_id",
    );
    assert.equal(pointerUpsert?.update.value, "object-new");
    assert.deepEqual(deletedRemoteKeys, [
      "tenants/tenant-a/branding/logo/old/logo.png",
    ]);
    assert.equal(
      (updateCalls[0] as { data: { status: string } }).data.status,
      "deleted",
    );
  });

  it("remove clears the pointer, deletes the object and stays idempotent", async () => {
    const settingRows: { key: string; value: unknown }[] = [
      { key: "branding_logo_object_id", value: "object-current" },
    ];
    const { service, settingUpserts, deletedRemoteKeys } = buildService({
      settingRows,
      storageRows: [
        {
          id: "object-current",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/branding/logo/current/logo.png",
          purpose: "branding_logo",
          contentType: "image/png",
          sizeBytes: null,
          status: "active",
          createdByUserId: "user-a",
        },
      ],
    });

    await service.removeLogo(context as never);

    const pointerUpsert = settingUpserts.find(
      (upsert) =>
        upsert.where.tenantId_key.key === "branding_logo_object_id",
    );
    assert.notEqual(pointerUpsert, undefined);
    assert.deepEqual(deletedRemoteKeys, [
      "tenants/tenant-a/branding/logo/current/logo.png",
    ]);

    // Second call: pointer already cleared, nothing left to delete.
    settingRows.length = 0;
    deletedRemoteKeys.length = 0;
    const settingsAfter = await service.removeLogo(context as never);

    assert.equal(settingsAfter.logo, null);
    assert.deepEqual(deletedRemoteKeys, []);
  });

  it("getSettings mints a download URL for the active logo", async () => {
    const { service } = buildService({
      settingRows: [
        { key: "branding_logo_object_id", value: "object-current" },
      ],
      storageRows: [
        {
          id: "object-current",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/branding/logo/current/logo.png",
          purpose: "branding_logo",
          contentType: "image/png",
          sizeBytes: null,
          status: "active",
          createdByUserId: "user-a",
        },
      ],
    });

    const settings = await service.getSettings(context as never);

    assert.equal(settings.logo?.storageObjectId, "object-current");
    assert.equal(
      settings.logo?.url,
      "https://r2.example/download/object-current",
    );
  });
});
