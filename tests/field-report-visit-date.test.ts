import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisitsService } from "../src/modules/visits/visits.service";
import { VISIT_DATE_BACKDATE_WINDOW_DAYS } from "../src/modules/visits/shelf-check";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "reports.confirm_own"],
};

const createdAt = new Date("2026-07-20T09:00:00.000Z");

const dayMs = 24 * 60 * 60 * 1000;

// All dates are computed from the wall clock: the window is relative to the
// server's "today", so literals would rot as time moves on.
function utcDateIso(daysFromToday: number): string {
  return new Date(Date.now() + daysFromToday * dayMs)
    .toISOString()
    .slice(0, 10);
}

function buildVisit() {
  return {
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
    representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
  };
}

function buildService(): VisitsService {
  const report = {
    id: "report-a",
    visitId: "visit-a",
    locationId: "location-a",
    representativeUserId: "rep-a",
    templateCode: "distribution",
    schemaVersion: "field-report.v1",
    status: "confirmed",
    confirmedData: {},
    confirmedByUserId: "rep-a",
    confirmedAt: createdAt,
    aiMetadata: null,
    createdAt,
    updatedAt: createdAt,
  };
  const prisma = {
    visit: { findFirst: async () => buildVisit() },
    platformTenant: {
      findUnique: async () => ({ segmentTemplate: "distribution" }),
    },
    task: { findMany: async () => [] },
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        report: { upsert: async () => report },
        visit: { update: async () => {} },
        routeItem: { update: async () => {} },
        locationAssortment: {
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
      }),
  };

  return new VisitsService(prisma as never);
}

function confirm(
  service: VisitsService,
  visitDate: unknown,
  schemaVersion = "field-report.v1",
) {
  return service.confirmReport(context as never, "visit-a", {
    confirmedData: {
      summary: "",
      tasksToCreate: [],
      fieldReport: { visitDate, productUpdates: [] },
    },
    schemaVersion,
  });
}

async function assertRejected(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: { getResponse?: () => { code?: string } }) => {
      assert.equal(error.getResponse?.().code, "REPORT_INVALID");

      return true;
    },
  );
}

describe("field-report.v1 visit date window", () => {
  it("accepts today, in-window backdates and the timezone grace edges", async () => {
    const service = buildService();

    for (const visitDate of [
      utcDateIso(0),
      utcDateIso(-1),
      utcDateIso(-VISIT_DATE_BACKDATE_WINDOW_DAYS),
      // ±1 day beyond the strict bounds stays legal: the server checks
      // against its UTC date and a rep's local calendar can differ by a day.
      utcDateIso(-VISIT_DATE_BACKDATE_WINDOW_DAYS - 1),
      utcDateIso(1),
    ]) {
      await confirm(service, visitDate);
    }
  });

  it("accepts an absent visit date", async () => {
    const service = buildService();

    await confirm(service, undefined);
    await confirm(service, null);
  });

  it("rejects a future visit date", async () => {
    await assertRejected(confirm(buildService(), utcDateIso(2)));
  });

  it("rejects a visit date older than the backdating window", async () => {
    await assertRejected(
      confirm(buildService(), utcDateIso(-VISIT_DATE_BACKDATE_WINDOW_DAYS - 2)),
    );
  });

  it("rejects malformed visit dates", async () => {
    const service = buildService();

    for (const visitDate of ["not-a-date", "2026-02-31", "20-07-2026", 42]) {
      await assertRejected(confirm(service, visitDate));
    }
  });

  it("leaves manual.v1 confirmations unchecked", async () => {
    // The manual fallback path never carried a structured visit date; a
    // legacy payload with one must keep confirming.
    await confirm(buildService(), utcDateIso(-30), "manual.v1");
  });
});
