import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { VisitsService } from "../src/modules/visits/visits.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own"],
};

const createdAt = new Date("2026-07-26T10:00:00.000Z");

function buildPrisma(
  createdStorageObjects: unknown[],
  overrides: { visit?: unknown; expiredQueries?: unknown[] } = {},
) {
  const {
    visit = {
      id: "visit-a",
      tenantId: "tenant-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      routeItemId: null,
      visitType: "planned",
      status: "in_progress",
      startedAt: createdAt,
      completedAt: null,
      cancelledAt: null,
      createdAt,
      updatedAt: createdAt,
      location: {
        id: "location-a",
        name: "Location A",
        addressLine: "Street 1",
        city: "Kyiv",
      },
      representative: {
        id: "rep-a",
        email: "rep@example.com",
        name: "Rep A",
      },
    },
  } = overrides;

  const storageObject = {
    create: async (query: unknown) => {
      createdStorageObjects.push(query);
      const data = (query as { data: Record<string, unknown> }).data;

      return {
        id: "storage-photo-a",
        bucket: data.bucket,
        objectKey: data.objectKey,
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
      };
    },
    updateMany: async (query: unknown) => {
      overrides.expiredQueries?.push(query);

      return { count: 1 };
    },
  };

  return {
    visit: { findFirst: async () => visit },
    storageObject,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ storageObject }),
  };
}

// A registered photo is not yet a kept photo: it starts with an expiry so a
// re-picked, discarded or abandoned upload gets collected, and only
// `confirmReport` clears that expiry for the object the report references
// (see visit-problem-photo-lifecycle.test.ts). These pin the register half:
// the dedicated `visit_attachment` purpose, the expiry, the per-visit sweep
// of earlier photos, and no `VisitNote` row.
describe("visit problem photo registration", () => {
  it("registers a visit_attachment that expires until a report claims it", async () => {
    const createdStorageObjects: unknown[] = [];
    const expiredQueries: unknown[] = [];
    const service = new VisitsService(
      buildPrisma(createdStorageObjects, { expiredQueries }) as never,
    );

    const response = await service.registerProblemPhotoUpload(
      context as never,
      "visit-a",
      { fileName: "problem.jpg", contentType: "image/jpeg", sizeBytes: 2048 },
    );

    assert.equal(response.storageObject.id, "storage-photo-a");
    assert.equal(response.storageObject.sizeBytes, "2048");
    assert.equal(createdStorageObjects.length, 1);

    const data = (createdStorageObjects[0] as { data: Record<string, unknown> })
      .data;
    assert.equal(data.purpose, "visit_attachment");
    assert.equal(data.contentType, "image/jpeg");
    assert.equal(data.tenantId, "tenant-a");
    assert.equal(data.createdByUserId, "rep-a");
    assert.ok(data.expiresAt instanceof Date);
    assert.match(
      String(data.objectKey),
      /^tenants\/tenant-a\/visits\/visit-a\/photos\/.+\/problem\.jpg$/,
    );

    // Registering again for the same visit must not leave the previous photo
    // behind with nothing referencing it.
    assert.equal(expiredQueries.length, 1);
    const sweep = expiredQueries[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    assert.equal(sweep.where.tenantId, "tenant-a");
    assert.equal(sweep.where.purpose, "visit_attachment");
    assert.equal(sweep.where.status, "active");
    // A claimed photo has `expiresAt: null` — a later registration against
    // the same visit must expire only unclaimed ones, or it would break the
    // image a confirmed report still references.
    assert.deepEqual(sweep.where.expiresAt, { not: null });
    assert.deepEqual(sweep.where.objectKey, {
      startsWith: "tenants/tenant-a/visits/visit-a/photos/",
    });
    assert.equal(sweep.data.status, "expired");
  });

  it("derives the content type from the file name when the browser sends none", async () => {
    const createdStorageObjects: unknown[] = [];
    const service = new VisitsService(
      buildPrisma(createdStorageObjects) as never,
    );

    await service.registerProblemPhotoUpload(context as never, "visit-a", {
      fileName: "shelf.HEIC",
      contentType: "",
      sizeBytes: 1024,
    });

    const data = (createdStorageObjects[0] as { data: Record<string, unknown> })
      .data;
    assert.equal(data.contentType, "image/heic");
  });

  it("rejects a non-image content type", async () => {
    const service = new VisitsService(buildPrisma([]) as never);

    await assert.rejects(
      () =>
        service.registerProblemPhotoUpload(context as never, "visit-a", {
          fileName: "report.pdf",
          contentType: "application/pdf",
          sizeBytes: 1024,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "PHOTO_UPLOAD_INVALID",
        );
        return true;
      },
    );
  });

  it("rejects a photo over the size cap", async () => {
    const service = new VisitsService(buildPrisma([]) as never);

    await assert.rejects(
      () =>
        service.registerProblemPhotoUpload(context as never, "visit-a", {
          fileName: "huge.jpg",
          contentType: "image/jpeg",
          sizeBytes: 11 * 1024 * 1024,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "PHOTO_UPLOAD_SIZE_INVALID",
        );
        return true;
      },
    );
  });

  it("rejects a registration with no declared size", async () => {
    // Required, not optional: the presigned PUT signs this as Content-Length,
    // so a registration without one would mean signing an unbounded upload.
    const service = new VisitsService(buildPrisma([]) as never);

    await assert.rejects(
      () =>
        service.registerProblemPhotoUpload(context as never, "visit-a", {
          fileName: "shelf.jpg",
          contentType: "image/jpeg",
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "PHOTO_UPLOAD_SIZE_INVALID",
        );
        return true;
      },
    );
  });

  it("refuses a visit that belongs to another representative", async () => {
    const service = new VisitsService(
      buildPrisma([], {
        visit: {
          id: "visit-a",
          tenantId: "tenant-a",
          locationId: "location-a",
          representativeUserId: "someone-else",
          routeItemId: null,
          visitType: "planned",
          status: "in_progress",
          startedAt: createdAt,
          completedAt: null,
          cancelledAt: null,
          createdAt,
          updatedAt: createdAt,
          location: {
            id: "location-a",
            name: "Location A",
            addressLine: "Street 1",
            city: "Kyiv",
          },
          representative: {
            id: "someone-else",
            email: "other@example.com",
            name: "Other",
          },
        },
      }) as never,
    );

    await assert.rejects(() =>
      service.registerProblemPhotoUpload(context as never, "visit-a", {
        fileName: "problem.jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
      }),
    );
  });
});
