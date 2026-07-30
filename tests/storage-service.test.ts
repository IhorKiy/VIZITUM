import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { StorageService } from "../src/modules/storage/storage.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "visits.read_own"],
};

const createdAt = new Date("2026-06-30T10:00:00.000Z");

describe("storage service", () => {
  it("creates an upload URL only for an active tenant object owned by the user", async () => {
    const prisma = {
      storageObject: {
        findFirst: async () => ({
          id: "storage-a",
          tenantId: "tenant-a",
          bucket: "vizitum",
          objectKey: "tenants/tenant-a/visits/visit-a/audio/file.webm",
          purpose: "temporary_audio",
          contentType: "audio/webm",
          sizeBytes: BigInt(1234),
          checksum: "sha256:abc",
          status: "active",
          expiresAt: new Date("2026-07-01T10:00:00.000Z"),
          createdByUserId: "rep-a",
          createdAt,
          deletedAt: null,
        }),
      },
    };
    const s3Storage = {
      createPresignedObjectUrl: (input: Record<string, unknown>) => ({
        url: `https://storage.example/${input.objectKey as string}`,
        method: input.method,
        expiresAt: new Date("2026-06-30T10:05:00.000Z"),
        headers: { "content-type": input.contentType as string },
      }),
    };
    const service = new StorageService(
      prisma as never,
      { getDefaultBucket: () => "vizitum" } as never,
      s3Storage as never,
    );

    const response = await service.createPresignedUploadUrl(
      context as never,
      "storage-a",
      300,
    );

    assert.equal(response.method, "PUT");
    assert.equal(
      response.url,
      "https://storage.example/tenants/tenant-a/visits/visit-a/audio/file.webm",
    );
    assert.deepEqual(response.headers, { "content-type": "audio/webm" });
  });

  it("refuses an upload URL for a visit artifact with no creator", async () => {
    // `temporary_transcript` rows are written by the AI worker, which has no
    // request context and therefore stamps no creator. While an absent creator
    // read as "unowned, so writable", any rep in the tenant could ask for a
    // presigned PUT over any transcript in it — and once the field form's retry
    // reached this endpoint from the browser, that was one client call away
    // rather than server-side only.
    const ownerlessTranscript = {
      id: "storage-transcript",
      tenantId: "tenant-a",
      bucket: "vizitum",
      objectKey: "tenants/tenant-a/visits/visit-b/transcript/uuid.json",
      purpose: "temporary_transcript",
      contentType: "application/json",
      sizeBytes: BigInt(512),
      checksum: null,
      status: "active",
      expiresAt: new Date("2026-07-01T10:00:00.000Z"),
      createdByUserId: null,
      createdAt,
      deletedAt: null,
    };
    const service = new StorageService(
      {
        storageObject: { findFirst: async () => ownerlessTranscript },
      } as never,
      { getDefaultBucket: () => "vizitum" } as never,
      {
        createPresignedObjectUrl: () => {
          throw new Error("must not be signed");
        },
      } as never,
    );

    await assert.rejects(
      () =>
        service.createPresignedUploadUrl(
          context as never,
          "storage-transcript",
        ),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "MISSING_PERMISSION",
    );
  });

  it("physically deletes expired temporary objects and marks them deleted", async () => {
    const deletedObjects: string[] = [];
    const updates: unknown[] = [];
    const now = new Date("2026-06-30T11:00:00.000Z");
    const prisma = {
      storageObject: {
        findMany: async () => [
          {
            id: "storage-a",
            bucket: "vizitum",
            objectKey: "tenants/tenant-a/tmp/audio/a.webm",
          },
          {
            id: "storage-b",
            bucket: "vizitum",
            objectKey: "tenants/tenant-a/tmp/transcripts/b.json",
          },
        ],
        update: async (query: unknown) => {
          updates.push(query);

          return {};
        },
      },
    };
    const s3Storage = {
      deleteObject: async (_bucket: string, objectKey: string) => {
        deletedObjects.push(objectKey);
      },
    };
    const service = new StorageService(
      prisma as never,
      { getDefaultBucket: () => "vizitum" } as never,
      s3Storage as never,
    );

    const result = await service.cleanupExpiredTemporaryObjects(now);

    assert.deepEqual(deletedObjects, [
      "tenants/tenant-a/tmp/audio/a.webm",
      "tenants/tenant-a/tmp/transcripts/b.json",
    ]);
    assert.equal(result.scannedObjectCount, 2);
    assert.equal(result.deletedObjectCount, 2);
    assert.equal(result.failedObjectCount, 0);
    assert.deepEqual(updates, [
      {
        where: { id: "storage-a" },
        data: { status: "deleted", deletedAt: now },
      },
      {
        where: { id: "storage-b" },
        data: { status: "deleted", deletedAt: now },
      },
    ]);
  });

  it("selects every temporary purpose whose expiry has passed, whatever its status", async () => {
    // The filter itself, which nothing pinned before — and which was the bug.
    // It used to require `status: "expired"` for audio and transcripts, and
    // nothing ever set that: the field-report flow creates no AiJob, so its
    // audio stays `active` forever, and the two AiJob writers that did mark it
    // `expired` stamped `deletedAt` in the same update, which this same filter
    // excludes. The result was that no audio was ever deleted from R2 by any
    // path, while data-model.md went on promising the cleanup worker removed it.
    let where: Record<string, unknown> | null = null;
    const prisma = {
      storageObject: {
        findMany: async (query: { where: Record<string, unknown> }) => {
          where = query.where;

          return [];
        },
        update: async () => ({}),
      },
    };
    const service = new StorageService(
      prisma as never,
      { getDefaultBucket: () => "vizitum" } as never,
      { deleteObject: async () => undefined } as never,
    );
    const now = new Date("2026-06-30T11:00:00.000Z");

    await service.cleanupExpiredTemporaryObjects(now);

    assert.ok(where);
    // Bytes still present. Only this sweep stamps `deletedAt`, and only after
    // the R2 delete succeeds, so it means exactly "already gone".
    assert.equal((where as { deletedAt: unknown }).deletedAt, null);
    // The expiry is the contract, not the status.
    assert.deepEqual((where as { expiresAt: unknown }).expiresAt, { lte: now });
    // An abandoned registration is `active` and is collected only by this.
    assert.deepEqual((where as { status: unknown }).status, {
      in: ["active", "expired"],
    });
    assert.deepEqual((where as { purpose: unknown }).purpose, {
      in: ["temporary_audio", "temporary_transcript", "visit_attachment"],
    });
    // A durable purpose must never be swept by expiry alone.
    const purposes = (where as { purpose: { in: string[] } }).purpose.in;
    for (const durable of [
      "import_file",
      "export_file",
      "attachment",
      "branding_logo",
    ]) {
      assert.equal(
        purposes.includes(durable),
        false,
        `${durable} must not be collected by the temporary sweep`,
      );
    }
  });

  it("gates branding_logo objects on tenant settings permissions", async () => {
    const brandingLogoRow = {
      id: "storage-logo",
      tenantId: "tenant-a",
      bucket: "vizitum",
      objectKey: "tenants/tenant-a/branding/logo/uuid/logo.png",
      purpose: "branding_logo",
      contentType: "image/png",
      sizeBytes: BigInt(2048),
      checksum: null,
      status: "active",
      expiresAt: null,
      createdByUserId: "admin-a",
      createdAt,
      deletedAt: null,
    };
    const prisma = {
      storageObject: {
        findFirst: async () => brandingLogoRow,
      },
    };
    const s3Storage = {
      createPresignedObjectUrl: (input: Record<string, unknown>) => ({
        url: `https://storage.example/${input.objectKey as string}`,
        method: input.method,
        expiresAt: new Date("2026-06-30T10:05:00.000Z"),
        headers: {},
      }),
    };
    const service = new StorageService(
      prisma as never,
      { getDefaultBucket: () => "vizitum" } as never,
      s3Storage as never,
    );

    const adminContext = {
      ...context,
      userId: "admin-a",
      roleCodes: ["company_admin"],
      permissions: ["tenant.settings.read", "tenant.settings.manage"],
    };

    const upload = await service.createPresignedUploadUrl(
      adminContext as never,
      "storage-logo",
    );
    assert.equal(upload.method, "PUT");

    const download = await service.createPresignedDownloadUrl(
      adminContext as never,
      "storage-logo",
    );
    assert.equal(download.method, "GET");

    // A field representative holds neither tenant settings permission.
    await assert.rejects(
      () => service.createPresignedUploadUrl(context as never, "storage-logo"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "MISSING_PERMISSION",
    );
    await assert.rejects(
      () =>
        service.createPresignedDownloadUrl(context as never, "storage-logo"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "MISSING_PERMISSION",
    );
  });
});
