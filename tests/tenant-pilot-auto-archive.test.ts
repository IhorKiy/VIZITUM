import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolvePilotAutoArchiveDays } from "../src/modules/platform/tenant-purge.service";
import {
  createPurgeStore,
  createTenantPurgeService,
} from "./fixtures/tenant-purge-store";

const NOW = new Date("2026-07-07T12:00:00.000Z");
const WINDOW = { autoArchiveDays: 60 };
const STALE_CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

describe("pilot tenant auto-archive", () => {
  it("is disabled when the env window is unset: scans and archives nothing", async () => {
    const store = createPurgeStore([
      { id: "tenant-stale", status: "pilot", createdAt: STALE_CREATED_AT },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, {
      autoArchiveDays: null,
    });

    assert.deepEqual(result, {
      enabled: false,
      scannedTenantCount: 0,
      archivedTenantCount: 0,
    });
    assert.equal(store.tenants[0].status, "pilot");
    assert.equal(store.events.length, 0);
  });

  it("archives a pilot with no activity inside the window and records tenant.auto_archived", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-stale",
        slug: "stale-pilot",
        name: "Stale Pilot",
        status: "pilot",
        createdAt: STALE_CREATED_AT,
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.enabled, true);
    assert.equal(result.archivedTenantCount, 1);
    assert.equal(store.tenants[0].status, "archived");
    assert.deepEqual(store.tenants[0].archivedAt, NOW);
    assert.equal(store.events.length, 1);
    assert.equal(store.events[0]?.eventType, "tenant.auto_archived");
    const metadata = store.events[0]?.metadata as {
      slug: string;
      previousStatus: string;
      lastActivityAt: string;
      autoArchiveDays: number;
    };
    assert.equal(metadata.slug, "stale-pilot");
    assert.equal(metadata.previousStatus, "pilot");
    assert.equal(metadata.lastActivityAt, STALE_CREATED_AT.toISOString());
    assert.equal(metadata.autoArchiveDays, 60);
  });

  it("keeps a pilot with recent session activity", async () => {
    const store = createPurgeStore([
      { id: "tenant-active", status: "pilot", createdAt: STALE_CREATED_AT },
    ]);
    store.activityByTenantId.set("tenant-active", {
      sessionLastSeenAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.scannedTenantCount, 1);
    assert.equal(result.archivedTenantCount, 0);
    assert.equal(store.tenants[0].status, "pilot");
    assert.equal(store.events.length, 0);
  });

  it("counts visits and imports as activity, not just sessions", async () => {
    const store = createPurgeStore([
      { id: "tenant-visits", status: "pilot", createdAt: STALE_CREATED_AT },
      { id: "tenant-imports", status: "pilot", createdAt: STALE_CREATED_AT },
    ]);
    store.activityByTenantId.set("tenant-visits", {
      visitUpdatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    store.activityByTenantId.set("tenant-imports", {
      importCreatedAt: new Date("2026-06-25T00:00:00.000Z"),
    });
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.archivedTenantCount, 0);
    assert.ok(store.tenants.every((tenant) => tenant.status === "pilot"));
  });

  it("archives a pilot whose only activity is older than the window", async () => {
    const store = createPurgeStore([
      { id: "tenant-lapsed", status: "pilot", createdAt: STALE_CREATED_AT },
    ]);
    store.activityByTenantId.set("tenant-lapsed", {
      sessionLastSeenAt: new Date("2026-02-01T00:00:00.000Z"),
      visitUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.archivedTenantCount, 1);
    const metadata = store.events[0]?.metadata as { lastActivityAt: string };
    assert.equal(metadata.lastActivityAt, "2026-03-01T00:00:00.000Z");
  });

  it("never touches a pilot younger than the window, even with zero activity", async () => {
    const store = createPurgeStore([
      {
        id: "tenant-new",
        status: "pilot",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.scannedTenantCount, 0);
    assert.equal(store.tenants[0].status, "pilot");
  });

  it("only pilots are auto-archived — paying and suspended tenants are out of scope", async () => {
    const store = createPurgeStore([
      { id: "tenant-team", status: "team", createdAt: STALE_CREATED_AT },
      {
        id: "tenant-business",
        status: "business",
        createdAt: STALE_CREATED_AT,
      },
      {
        id: "tenant-suspended",
        status: "suspended",
        createdAt: STALE_CREATED_AT,
      },
    ]);
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.scannedTenantCount, 0);
    assert.equal(store.events.length, 0);
  });

  it("closes the race: a pilot upgraded concurrently is not archived and gets no event", async () => {
    const store = createPurgeStore([
      { id: "tenant-upgraded", status: "pilot", createdAt: STALE_CREATED_AT },
    ]);
    // The platform owner moves the tenant to a paid plan between the
    // worker's read and its conditional archive write.
    store.raceState.beforeUpdateMany = () => {
      store.tenants[0].status = "team";
    };
    const { service } = createTenantPurgeService(store);

    const result = await service.autoArchiveStalePilots(NOW, WINDOW);

    assert.equal(result.scannedTenantCount, 1);
    assert.equal(result.archivedTenantCount, 0);
    assert.equal(store.tenants[0].status, "team");
    assert.equal(store.events.length, 0);
  });
});

describe("TENANT_PILOT_AUTO_ARCHIVE_DAYS resolution", () => {
  it("is disabled (null) when unset or empty — auto-archive is opt-in", () => {
    assert.equal(resolvePilotAutoArchiveDays(undefined), null);
    assert.equal(resolvePilotAutoArchiveDays(""), null);
    assert.equal(resolvePilotAutoArchiveDays("  "), null);
  });

  it("accepts positive integers", () => {
    assert.equal(resolvePilotAutoArchiveDays("60"), 60);
    assert.equal(resolvePilotAutoArchiveDays(" 90 "), 90);
  });

  it("refuses zero, negatives and garbage instead of guessing", () => {
    for (const value of ["0", "-30", "2.5", "sixty", "60d"]) {
      assert.throws(() => resolvePilotAutoArchiveDays(value));
    }
  });
});
