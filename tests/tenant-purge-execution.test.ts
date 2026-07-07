import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPurgeStore,
  createTenantPurgeService,
  TENANT_OWNED_TABLES,
} from "./fixtures/tenant-purge-store";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const RETENTION = { retentionDays: 30 };
const ELIGIBLE_ARCHIVED_AT = new Date("2026-05-01T00:00:00.000Z");

describe("tenant purge execution", () => {
  it("deletes storage first, then rows child-before-parent, then the tenant", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        slug: "pilot-a",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
    ]);

    for (const table of TENANT_OWNED_TABLES) {
      store.seedRows(table, "tenant-1", 2);
    }

    const { service } = createTenantPurgeService(store, {
      storageResults: {
        "tenant-1": {
          scannedObjectCount: 3,
          deletedObjectCount: 3,
          failedObjectCount: 0,
        },
      },
    });

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.purgedTenantCount, 1);
    // Storage strictly before any row deletion, rows in the declared
    // dependency order (children before parents, users last), tenant last.
    assert.deepEqual(store.deletionLog, [
      "storage:tenant-1",
      ...TENANT_OWNED_TABLES.map((table) => `${table}:tenant-1:2`),
      "tenant:tenant-1",
    ]);
    assert.equal(store.remainingRowCount("tenant-1"), 0);
    assert.equal(store.tenants.length, 0);
  });

  it("stamps purgeStartedAt before deleting and emits start + completion events with counts", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        slug: "pilot-a",
        name: "Pilot A",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
    ]);
    store.seedRows("visits", "tenant-1", 5);
    store.seedRows("users", "tenant-1", 2);

    const { service } = createTenantPurgeService(store, {
      storageResults: {
        "tenant-1": {
          scannedObjectCount: 4,
          deletedObjectCount: 4,
          failedObjectCount: 0,
        },
      },
    });

    await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(store.events.length, 2);

    const [started, purged] = store.events;
    assert.equal(started?.eventType, "tenant.purge_started");
    assert.equal(started?.tenantId, "tenant-1");
    assert.equal(
      (started?.metadata as { reason: string }).reason,
      "retention_elapsed",
    );

    assert.equal(purged?.eventType, "tenant.purged");
    // The tenant row is gone, so the FK must be null and the id travels in
    // metadata instead.
    assert.equal(purged?.tenantId, null);
    const metadata = purged?.metadata as {
      tenantId: string;
      slug: string;
      name: string;
      storageObjectCount: number;
      rowCounts: Record<string, number>;
    };
    assert.equal(metadata.tenantId, "tenant-1");
    assert.equal(metadata.slug, "pilot-a");
    assert.equal(metadata.name, "Pilot A");
    assert.equal(metadata.storageObjectCount, 4);
    assert.equal(metadata.rowCounts.visits, 5);
    assert.equal(metadata.rowCounts.users, 2);
    assert.equal(metadata.rowCounts.locations, 0);
  });

  it("records purge_requested as the reason when the purge was explicitly requested", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: new Date("2026-07-06T00:00:00.000Z"),
        purgeRequestedAt: new Date("2026-07-06T01:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    await service.purgeEligibleTenants(NOW, RETENTION);

    const started = store.events.find(
      (event) => event.eventType === "tenant.purge_started",
    );
    assert.equal(
      (started?.metadata as { reason: string }).reason,
      "purge_requested",
    );
  });

  it("aborts row deletion when storage deletion fails, keeping the tenant claimed for retry", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
    ]);
    store.seedRows("visits", "tenant-1", 3);
    store.seedRows("users", "tenant-1", 1);

    const { service } = createTenantPurgeService(store, {
      storageResults: {
        "tenant-1": {
          scannedObjectCount: 2,
          deletedObjectCount: 1,
          failedObjectCount: 1,
        },
      },
    });

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.failedTenantCount, 1);
    assert.equal(result.purgedTenantCount, 0);
    // No rows deleted, tenant still there — but claimed, so it cannot be
    // unarchived and the next run picks it up again.
    assert.equal(store.remainingRowCount("tenant-1"), 4);
    assert.equal(store.tenants.length, 1);
    assert.ok(store.tenants[0].purgeStartedAt instanceof Date);
    assert.equal(
      store.events.filter((event) => event.eventType === "tenant.purged")
        .length,
      0,
    );
  });

  it("is re-runnable: a second run over an already-purged registry is a no-op", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
    ]);
    store.seedRows("visits", "tenant-1", 1);
    const { service } = createTenantPurgeService(store);

    const first = await service.purgeEligibleTenants(NOW, RETENTION);
    const second = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(first.purgedTenantCount, 1);
    assert.equal(second.scannedTenantCount, 0);
    assert.equal(second.purgedTenantCount, 0);
  });

  it("resumes an interrupted purge without emitting a second purge_started event", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
        // A previous run claimed the tenant and crashed after deleting some
        // child tables.
        purgeStartedAt: new Date("2026-07-06T00:00:00.000Z"),
      },
    ]);
    store.seedRows("users", "tenant-1", 2);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.purgedTenantCount, 1);
    assert.equal(store.tenants.length, 0);
    assert.equal(store.remainingRowCount("tenant-1"), 0);
    const eventTypes = store.events.map((event) => event.eventType);
    assert.deepEqual(eventTypes, ["tenant.purged"]);
  });

  it("skips a tenant that was concurrently unarchived between selection and claim", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
    ]);
    store.seedRows("users", "tenant-1", 1);
    // Simulate the platform owner unarchiving after the worker's
    // eligibility read but before its conditional claim.
    store.raceState.beforeUpdateMany = () => {
      store.tenants[0].status = "suspended";
      store.tenants[0].archivedAt = null;
      store.tenants[0].purgeRequestedAt = null;
    };
    const { service, storageCalls } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 1);
    assert.equal(result.skippedTenantCount, 1);
    assert.equal(result.purgedTenantCount, 0);
    assert.equal(storageCalls.length, 0);
    assert.equal(store.remainingRowCount("tenant-1"), 1);
    assert.equal(store.tenants.length, 1);
    assert.equal(store.events.length, 0);
  });

  it("purges multiple eligible tenants independently and leaves other tenants' rows untouched", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-1",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
      {
        id: "tenant-2",
        status: "archived",
        archivedAt: ELIGIBLE_ARCHIVED_AT,
      },
      { id: "tenant-live", status: "team" },
    ]);
    store.seedRows("visits", "tenant-1", 2);
    store.seedRows("visits", "tenant-2", 3);
    store.seedRows("visits", "tenant-live", 4);

    const { service } = createTenantPurgeService(store, {
      storageResults: {
        // tenant-1's storage fails, tenant-2 must still be purged.
        "tenant-1": {
          scannedObjectCount: 1,
          deletedObjectCount: 0,
          failedObjectCount: 1,
        },
      },
    });

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 2);
    assert.equal(result.failedTenantCount, 1);
    assert.equal(result.purgedTenantCount, 1);
    assert.equal(store.remainingRowCount("tenant-1"), 2);
    assert.equal(store.remainingRowCount("tenant-2"), 0);
    assert.equal(store.remainingRowCount("tenant-live"), 4);
    assert.deepEqual(store.tenants.map((tenant) => tenant.id).sort(), [
      "tenant-1",
      "tenant-live",
    ]);
  });
});
