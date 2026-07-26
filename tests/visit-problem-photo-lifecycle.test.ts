import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { StorageService } from "../src/modules/storage/storage.service";
import { VisitsService } from "../src/modules/visits/visits.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "reports.confirm_own"],
};

const createdAt = new Date("2026-07-26T10:00:00.000Z");

const visit = {
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
  location: { id: "location-a", name: "Location A" },
  representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
};

function buildPrisma(claims: unknown[]) {
  const tx = {
    report: {
      upsert: async () => ({
        id: "report-a",
        tenantId: "tenant-a",
        visitId: "visit-a",
        templateCode: "distribution",
        schemaVersion: "field-report.v1",
        status: "confirmed",
        confirmedData: {},
        confirmedByUserId: "rep-a",
        confirmedAt: createdAt,
        aiMetadata: null,
        createdAt,
        updatedAt: createdAt,
      }),
    },
    visit: { update: async () => visit },
    routeItem: { update: async () => ({}) },
    task: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    storageObject: {
      updateMany: async (query: unknown) => {
        claims.push(query);

        return { count: 1 };
      },
    },
  };

  return {
    visit: { findFirst: async () => visit },
    platformTenant: {
      findUnique: async () => ({ segmentTemplate: "distribution" }),
    },
    task: { findMany: async () => [] },
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(tx),
  };
}

function confirmWith(problem: unknown, claims: unknown[]) {
  const service = new VisitsService(buildPrisma(claims) as never);

  return service.confirmReport(context as never, "visit-a", {
    schemaVersion: "field-report.v1",
    confirmedData: { fieldReport: { problem } },
  } as never);
}

// A problem photo is registered with an expiry so an abandoned or re-picked
// upload gets collected. Confirming the report is the only thing that makes
// one permanent, and only the object that report actually points at.
describe("visit problem photo lifecycle", () => {
  it("clears the expiry of the photo the confirmed report references", async () => {
    const claims: unknown[] = [];

    await confirmWith(
      { type: "expired", note: "two cases", photoObjectId: "photo-a" },
      claims,
    );

    assert.equal(claims.length, 1);
    const claim = claims[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    assert.equal(claim.where.id, "photo-a");
    assert.equal(claim.where.tenantId, "tenant-a");
    assert.equal(claim.where.purpose, "visit_attachment");
    // Scoped to this visit's own prefix as well as the id, so a payload can't
    // adopt another visit's (or tenant's) object by guessing an id.
    assert.deepEqual(claim.where.objectKey, {
      startsWith: "tenants/tenant-a/visits/visit-a/photos/",
    });
    assert.equal(claim.data.expiresAt, null);
    assert.equal(claim.data.status, "active");
  });

  it("claims nothing when the report carries no problem photo", async () => {
    const withoutPhoto: unknown[] = [];
    await confirmWith(
      { type: "conflict", note: "argued about shelf space", photoObjectId: null },
      withoutPhoto,
    );
    assert.equal(withoutPhoto.length, 0);

    const withoutProblem: unknown[] = [];
    await confirmWith(null, withoutProblem);
    assert.equal(withoutProblem.length, 0);
  });
});
