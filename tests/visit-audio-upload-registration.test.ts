import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisitsService } from "../src/modules/visits/visits.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own"],
};

describe("visit audio upload registration", () => {
  it("registers a temporary audio storage object and audio note", async () => {
    const createdStorageObjects: unknown[] = [];
    const createdNotes: unknown[] = [];
    const createdAt = new Date("2026-06-29T10:00:00.000Z");
    const prisma = {
      visit: {
        findFirst: async () => ({
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
        }),
      },
      $transaction: async (
        callback: (transaction: {
          storageObject: {
            create: (
              query: unknown,
            ) => Promise<{ id: string } & Record<string, unknown>>;
          };
          visitNote: {
            create: (query: unknown) => Promise<Record<string, unknown>>;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          storageObject: {
            create: async (query: unknown) => {
              createdStorageObjects.push(query);

              return {
                id: "storage-a",
                bucket: "vizitum",
                objectKey:
                  "tenants/tenant-a/visits/visit-a/audio/random/visit.webm",
                contentType: "audio/webm;codecs=opus",
                sizeBytes: BigInt(1234),
                checksum: "sha256:abc",
                expiresAt: new Date("2026-06-30T10:00:00.000Z"),
              };
            },
          },
          visitNote: {
            create: async (query: unknown) => {
              createdNotes.push(query);

              return {
                id: "note-a",
                visitId: "visit-a",
                inputType: "audio",
                textContent: null,
                temporaryAudioObjectId: "storage-a",
                createdByUserId: "rep-a",
                createdAt,
              };
            },
          },
        }),
    };
    const service = new VisitsService(prisma as never);

    const response = await service.registerTemporaryAudioUpload(
      context as never,
      "visit-a",
      {
        fileName: "visit.webm",
        contentType: "audio/webm;codecs=opus",
        sizeBytes: 1234,
        checksum: "sha256:abc",
      },
    );

    assert.equal(response.note.temporaryAudioObjectId, "storage-a");
    assert.equal(response.storageObject.id, "storage-a");
    assert.equal(response.storageObject.sizeBytes, "1234");
    assert.equal(createdStorageObjects.length, 1);
    assert.equal(createdNotes.length, 1);
    const storageCreateQuery = createdStorageObjects[0] as {
      data: { objectKey: string };
    };

    assert.match(
      storageCreateQuery.data.objectKey,
      /tenants\/tenant-a\/visits\/visit-a\/audio\/.+\/visit\.webm/,
    );
    assert.deepEqual(createdNotes[0], {
      data: {
        tenantId: "tenant-a",
        visitId: "visit-a",
        inputType: "audio",
        temporaryAudioObjectId: "storage-a",
        createdByUserId: "rep-a",
      },
    });
  });

  it("normalizes common browser audio MIME aliases for fallback uploads", async () => {
    const createdStorageObjects: unknown[] = [];
    const createdAt = new Date("2026-06-29T10:00:00.000Z");
    const prisma = {
      visit: {
        findFirst: async () => ({
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
        }),
      },
      $transaction: async (
        callback: (transaction: {
          storageObject: {
            create: (
              query: unknown,
            ) => Promise<{ id: string } & Record<string, unknown>>;
          };
          visitNote: {
            create: (query: unknown) => Promise<Record<string, unknown>>;
          };
        }) => Promise<unknown>,
      ) =>
        callback({
          storageObject: {
            create: async (query: unknown) => {
              createdStorageObjects.push(query);

              return {
                id: "storage-a",
                bucket: "vizitum",
                objectKey:
                  "tenants/tenant-a/visits/visit-a/audio/random/visit.m4a",
                contentType: (query as { data: { contentType: string } }).data
                  .contentType,
                sizeBytes: BigInt(1234),
                checksum: null,
                expiresAt: new Date("2026-06-30T10:00:00.000Z"),
              };
            },
          },
          visitNote: {
            create: async () => ({
              id: "note-a",
              visitId: "visit-a",
              inputType: "audio",
              textContent: null,
              temporaryAudioObjectId: "storage-a",
              createdByUserId: "rep-a",
              createdAt,
            }),
          },
        }),
    };
    const service = new VisitsService(prisma as never);

    const response = await service.registerTemporaryAudioUpload(
      context as never,
      "visit-a",
      {
        fileName: "visit.m4a",
        contentType: "audio/x-m4a",
        sizeBytes: 1234,
      },
    );

    assert.equal(response.storageObject.contentType, "audio/mp4");
    assert.equal(createdStorageObjects.length, 1);
  });
});
