import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaService } from "../src/modules/prisma/prisma.service";
import type { S3StorageClient } from "../src/modules/storage/s3-storage.client";
import type { StorageConfigService } from "../src/modules/storage/storage.config";
import { StorageService } from "../src/modules/storage/storage.service";

const NOW = new Date("2026-07-07T12:00:00.000Z");

describe("storage tenant object purge", () => {
  it("deletes every live object of the tenant and marks rows deleted, leaving other tenants alone", async () => {
    const store = createStore([
      object("a1", "tenant-1", "active"),
      object("a2", "tenant-1", "expired"),
      object("b1", "tenant-2", "active"),
    ]);
    const service = createService(store);

    const result = await service.deleteAllTenantObjects("tenant-1", NOW);

    assert.equal(result.scannedObjectCount, 2);
    assert.equal(result.deletedObjectCount, 2);
    assert.equal(result.failedObjectCount, 0);
    assert.deepEqual(store.remoteDeletes, ["objects/a1", "objects/a2"]);
    assert.equal(rowById(store, "a1").status, "deleted");
    assert.deepEqual(rowById(store, "a1").deletedAt, NOW);
    assert.equal(rowById(store, "b1").status, "active");
  });

  it("skips rows already marked deleted, so a re-run does not touch R2 again", async () => {
    const store = createStore([
      { ...object("a1", "tenant-1", "deleted"), deletedAt: new Date() },
      object("a2", "tenant-1", "active"),
    ]);
    const service = createService(store);

    const result = await service.deleteAllTenantObjects("tenant-1", NOW);

    assert.equal(result.scannedObjectCount, 1);
    assert.deepEqual(store.remoteDeletes, ["objects/a2"]);
  });

  it("counts a failed remote delete without marking the row, and still processes the rest", async () => {
    const store = createStore([
      object("a1", "tenant-1", "active"),
      object("a2", "tenant-1", "active"),
      object("a3", "tenant-1", "active"),
    ]);
    store.failingKeys.add("objects/a2");
    const service = createService(store);

    const result = await service.deleteAllTenantObjects("tenant-1", NOW);

    assert.equal(result.deletedObjectCount, 2);
    assert.equal(result.failedObjectCount, 1);
    // The failed row keeps its status so the next purge run retries it.
    assert.equal(rowById(store, "a2").status, "active");
    assert.equal(rowById(store, "a1").status, "deleted");
    assert.equal(rowById(store, "a3").status, "deleted");
  });

  it("terminates in one pass even when every remote delete fails", async () => {
    const store = createStore([
      object("a1", "tenant-1", "active"),
      object("a2", "tenant-1", "active"),
    ]);
    store.failingKeys.add("objects/a1");
    store.failingKeys.add("objects/a2");
    const service = createService(store);

    const result = await service.deleteAllTenantObjects("tenant-1", NOW);

    assert.equal(result.failedObjectCount, 2);
    assert.equal(result.deletedObjectCount, 0);
    // Each failing object was attempted exactly once — no infinite retry
    // loop within a single run.
    assert.deepEqual(store.attemptedKeys, ["objects/a1", "objects/a2"]);
  });
});

type FakeStorageObjectRow = {
  id: string;
  tenantId: string;
  bucket: string;
  objectKey: string;
  status: string;
  deletedAt: Date | null;
};

function object(
  id: string,
  tenantId: string,
  status: string,
): FakeStorageObjectRow {
  return {
    id,
    tenantId,
    bucket: "test-bucket",
    objectKey: `objects/${id}`,
    status,
    deletedAt: null,
  };
}

function createStore(rows: FakeStorageObjectRow[]) {
  const failingKeys = new Set<string>();
  const remoteDeletes: string[] = [];
  const attemptedKeys: string[] = [];

  const prisma = {
    storageObject: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          tenantId: string;
          status: { not: string };
          id: { gt: string };
        };
        take: number;
      }) =>
        rows
          .filter(
            (row) =>
              row.tenantId === where.tenantId &&
              row.status !== where.status.not &&
              row.id > where.id.gt,
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map((row) => ({ ...row })),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeStorageObjectRow>;
      }) => {
        const row = rows.find((candidate) => candidate.id === where.id);

        if (!row) {
          throw new Error(`Row not found: ${where.id}`);
        }

        Object.assign(row, data);
        return { ...row };
      },
    },
  };

  const s3Storage = {
    deleteObject: async (_bucket: string, objectKey: string) => {
      attemptedKeys.push(objectKey);

      if (failingKeys.has(objectKey)) {
        throw new Error(`S3 delete failed for ${objectKey}.`);
      }

      remoteDeletes.push(objectKey);
    },
  };

  return { rows, prisma, s3Storage, failingKeys, remoteDeletes, attemptedKeys };
}

function rowById(
  store: ReturnType<typeof createStore>,
  id: string,
): FakeStorageObjectRow {
  const row = store.rows.find((candidate) => candidate.id === id);

  if (!row) {
    throw new Error(`Row not found: ${id}`);
  }

  return row;
}

function createService(store: ReturnType<typeof createStore>) {
  return new StorageService(
    store.prisma as unknown as PrismaService,
    {} as StorageConfigService,
    store.s3Storage as unknown as S3StorageClient,
  );
}
