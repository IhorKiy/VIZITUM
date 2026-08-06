import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LocationsService } from "../src/modules/locations/locations.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

function locationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "location-a",
    tenantId: "tenant-a",
    chainId: null,
    categoryId: null,
    externalCode: null,
    name: "Kyiv North Market",
    status: "active",
    addressLine: "Demo Avenue 10",
    city: "Kyiv",
    region: null,
    territory: null,
    latitude: null,
    longitude: null,
    notes: null,
    chain: null,
    category: null,
    contacts: [],
    assignments: [],
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

type AuditCall = {
  entityType: string;
  entityId: string;
  eventType: string;
  // The archive and its trail must commit together or not at all, so the
  // event has to arrive on the transaction client rather than on the service's
  // own prisma — recorded here so that is asserted rather than assumed.
  inTransaction: boolean;
};

function recordingAuditService(events: AuditCall[]) {
  return {
    recordEvent: async (
      _context: unknown,
      input: Omit<AuditCall, "inTransaction">,
      client?: unknown,
    ) => {
      events.push({ ...input, inTransaction: client !== undefined });
    },
  };
}

describe("location archive", () => {
  it("soft-archives a live location by stamping deletedAt", async () => {
    let findWhere: Record<string, unknown> | undefined;
    let updateArgs:
      { where: unknown; data: Record<string, unknown> } | undefined;
    const events: AuditCall[] = [];
    const service = new LocationsService(
      {
        location: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            findWhere = where;
            return locationRow();
          },
        },
        $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
          run({
            location: {
              update: async (args: {
                where: unknown;
                data: Record<string, unknown>;
              }) => {
                updateArgs = args;
                return locationRow({
                  deletedAt: new Date("2026-07-18T00:00:00.000Z"),
                });
              },
            },
          }),
      } as never,
      recordingAuditService(events) as never,
    );

    const result = await service.archiveLocation(
      context as never,
      "location-a",
    );

    // Only a live row (deletedAt: null) can be archived, scoped to the tenant.
    assert.equal(findWhere?.id, "location-a");
    assert.equal(findWhere?.tenantId, "tenant-a");
    assert.equal(findWhere?.deletedAt, null);
    // The write sets deletedAt to a timestamp and nothing else.
    assert.ok(updateArgs?.data.deletedAt instanceof Date);
    assert.deepEqual(Object.keys(updateArgs?.data ?? {}), ["deletedAt"]);
    assert.equal(result.archived, true);
    // Status is untouched — archival is orthogonal to active/inactive.
    assert.equal(result.status, "active");
    // Who did it, in the same transaction as the archive. Before audit F5 the
    // row recorded when to the millisecond and nothing about the actor, and
    // no `deletedBy` column exists anywhere in the schema to carry one.
    assert.deepEqual(events, [
      {
        entityType: "location",
        entityId: "location-a",
        eventType: "location.archived",
        inTransaction: true,
      },
    ]);
  });

  it("rejects archiving a location the tenant does not own", async () => {
    const service = new LocationsService({
      location: {
        findFirst: async () => null,
        update: async () => {
          throw new Error("update should not run when the location is absent");
        },
      },
    } as never);

    await assert.rejects(
      () => service.archiveLocation(context as never, "location-x"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "LOCATION_NOT_FOUND",
    );
  });

  it("returns an archived location through getLocation, unlike every other lookup", async () => {
    let findWhere: Record<string, unknown> | undefined;
    const service = new LocationsService({
      location: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          findWhere = where;
          return locationRow({
            deletedAt: new Date("2026-07-18T00:00:00.000Z"),
          });
        },
      },
    } as never);

    const result = await service.getLocation(context as never, "location-a");

    // GET /locations/:id is the one read that must not filter out archived
    // rows — the detail screen shows a restore-first notice instead of
    // 404ing. Every write and every other lookup keeps filtering deletedAt.
    assert.equal("deletedAt" in (findWhere ?? {}), false);
    assert.equal(result.archived, true);
  });

  it("restores an archived location by clearing deletedAt", async () => {
    let findWhere: Record<string, unknown> | undefined;
    let updateData: Record<string, unknown> | undefined;
    const events: AuditCall[] = [];
    const service = new LocationsService(
      {
        location: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            findWhere = where;
            return locationRow({
              deletedAt: new Date("2026-07-18T00:00:00.000Z"),
            });
          },
        },
        $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
          run({
            location: {
              update: async ({ data }: { data: Record<string, unknown> }) => {
                updateData = data;
                return locationRow({ deletedAt: null });
              },
            },
          }),
      } as never,
      recordingAuditService(events) as never,
    );

    const result = await service.restoreLocation(
      context as never,
      "location-a",
    );

    // Restore only considers already-archived rows (deletedAt: { not: null }).
    assert.equal(findWhere?.id, "location-a");
    assert.equal(findWhere?.tenantId, "tenant-a");
    assert.deepEqual(findWhere?.deletedAt, { not: null });
    assert.equal(updateData?.deletedAt, null);
    assert.equal(result.archived, false);
    // The archive's twin: a trail carrying only `location.archived` cannot
    // answer whether the outlet is archived *now*.
    assert.deepEqual(events, [
      {
        entityType: "location",
        entityId: "location-a",
        eventType: "location.restored",
        inTransaction: true,
      },
    ]);
  });

  it("rejects restoring a location that is not archived", async () => {
    const service = new LocationsService({
      location: {
        findFirst: async () => null,
        update: async () => {
          throw new Error(
            "update should not run when there is nothing to restore",
          );
        },
      },
    } as never);

    await assert.rejects(
      () => service.restoreLocation(context as never, "location-a"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "LOCATION_NOT_FOUND",
    );
  });

  it("never writes 'archived' as a status through a plain update", async () => {
    let updateData: Record<string, unknown> | undefined;
    const service = new LocationsService({
      location: {
        findFirst: async () => locationRow(),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return locationRow(data);
        },
      },
    } as never);

    await service.updateLocation(context as never, "location-a", {
      status: "archived",
    });

    // "archived" is not a writable status — a PATCH carrying it must not
    // corrupt the row (which would throw on the enum) or archive it.
    assert.ok(updateData && !("status" in updateData));

    await service.updateLocation(context as never, "location-a", {
      status: "inactive",
    });
    assert.equal(updateData?.status, "inactive");
  });

  it("filters archived rows by deletedAt, live rows otherwise", async () => {
    const captured: Record<string, unknown>[] = [];
    const service = new LocationsService({
      location: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          captured.push(where);
          return [];
        },
        count: async () => 0,
      },
    } as never);

    await service.listLocations(context as never, { status: "archived" });
    assert.deepEqual(captured[0]?.deletedAt, { not: null });
    assert.equal("status" in (captured[0] ?? {}), false);

    await service.listLocations(context as never, { status: "inactive" });
    assert.equal(captured[1]?.deletedAt, null);
    assert.equal(captured[1]?.status, "inactive");

    await service.listLocations(context as never, {});
    assert.equal(captured[2]?.deletedAt, null);
  });
});
