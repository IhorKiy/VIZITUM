import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TENANT_PURGE_RETENTION_DAYS,
  resolveTenantPurgeRetentionDays,
} from "../src/modules/platform/tenant-purge.service";
import {
  createPurgeStore,
  createTenantPurgeService,
} from "./fixtures/tenant-purge-store";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const RETENTION = { retentionDays: 30 };

describe("tenant purge eligibility", () => {
  it("purges an archived tenant once the retention window has elapsed", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-old",
        status: "archived",
        archivedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 1);
    assert.equal(result.purgedTenantCount, 1);
    assert.equal(store.tenants.length, 0);
  });

  it("leaves an archived tenant alone while the retention window is still open", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-fresh",
        status: "archived",
        archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
    const { service, storageCalls } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 0);
    assert.equal(store.tenants.length, 1);
    assert.equal(storageCalls.length, 0);
    assert.equal(store.events.length, 0);
  });

  it("treats the retention boundary as eligible exactly at cutoff", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-boundary",
        status: "archived",
        // Exactly 30 days before NOW.
        archivedAt: new Date("2026-06-07T12:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.purgedTenantCount, 1);
  });

  it("purgeRequestedAt overrides the retention window", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-requested",
        status: "archived",
        archivedAt: new Date("2026-07-06T00:00:00.000Z"),
        purgeRequestedAt: new Date("2026-07-06T01:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.purgedTenantCount, 1);
    assert.equal(store.tenants.length, 0);
  });

  it("never selects a non-archived tenant, even with stale dates or a stray purge mark", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-pilot",
        status: "pilot",
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "tenant-suspended",
        status: "suspended",
        purgeRequestedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "tenant-business",
        status: "business",
        purgeStartedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const { service, storageCalls } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 0);
    assert.equal(store.tenants.length, 3);
    assert.equal(storageCalls.length, 0);
  });

  it("always resumes an interrupted purge regardless of retention math", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-interrupted",
        status: "archived",
        // Retention window still open — but a purge already started, so the
        // tenant must be finished off, never left half-purged.
        archivedAt: new Date("2026-07-06T00:00:00.000Z"),
        purgeStartedAt: new Date("2026-07-06T02:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.purgedTenantCount, 1);
    assert.equal(store.tenants.length, 0);
  });

  it("an archived tenant without archivedAt is only eligible via an explicit request", async () => {
    const store = createPurgeStore([
      { id: "tenant-no-date", status: "archived", archivedAt: null },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.purgeEligibleTenants(NOW, RETENTION);

    assert.equal(result.scannedTenantCount, 0);
    assert.equal(store.tenants.length, 1);
  });
});

describe("TENANT_PURGE_RETENTION_DAYS resolution", () => {
  it("defaults to 30 days when unset or empty", () => {
    assert.equal(
      resolveTenantPurgeRetentionDays(undefined),
      DEFAULT_TENANT_PURGE_RETENTION_DAYS,
    );
    assert.equal(resolveTenantPurgeRetentionDays(""), 30);
    assert.equal(resolveTenantPurgeRetentionDays("  "), 30);
  });

  it("accepts zero (immediate eligibility) and positive integers", () => {
    assert.equal(resolveTenantPurgeRetentionDays("0"), 0);
    assert.equal(resolveTenantPurgeRetentionDays("7"), 7);
    assert.equal(resolveTenantPurgeRetentionDays(" 90 "), 90);
  });

  it("refuses to run on a misconfigured value instead of guessing", () => {
    for (const value of ["-1", "1.5", "thirty", "30d", "NaN"]) {
      assert.throws(() => resolveTenantPurgeRetentionDays(value));
    }
  });
});
