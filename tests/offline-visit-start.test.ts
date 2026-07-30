import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisitsService } from "../src/modules/visits/visits.service";

// Starting a visit is the first thing a rep does at a stop, and it needed signal.
// `clientVisitId` is the id their phone mints so the start can be sent later: it
// makes the create safe to repeat, and it gives the locally-started visit a URL
// that keeps working once the server has it.
//
// The hard part is not the idempotency, it is the stop's single visit slot.
// `Visit.routeItemId` is unique across every status, so a deferred start can
// arrive to find that slot already taken — and what the rep meant depends
// entirely on what is sitting there.

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.create", "visits.update_own", "visits.read_own"],
};

function buildVisitRow(overrides: Record<string, unknown> = {}) {
  const at = new Date("2026-07-30T09:00:00.000Z");

  return {
    id: "visit-existing",
    tenantId: "tenant-a",
    locationId: "location-a",
    representativeUserId: "rep-a",
    routeItemId: "route-item-a",
    visitType: "field_visit",
    status: "in_progress",
    startedAt: at,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationComment: null,
    clientVisitId: null,
    createdAt: at,
    updatedAt: at,
    location: {
      id: "location-a",
      name: "Location A",
      addressLine: "Street 1",
      city: "Kyiv",
    },
    representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
    ...overrides,
  };
}

// Stubs only what createVisit touches, and records the create so a test can
// assert what was *not* written as well as what was.
function buildPrisma(options: {
  replayed?: ReturnType<typeof buildVisitRow> | null;
  slotHolder?: ReturnType<typeof buildVisitRow> | null;
} = {}) {
  const creates: { data: Record<string, unknown> }[] = [];

  return {
    creates,
    prisma: {
      location: { findFirst: async () => ({ id: "location-a" }) },
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routeItem: { findFirst: async () => ({ id: "route-item-a" }) },
      visit: {
        findUnique: async () => options.replayed ?? null,
        findFirst: async () => options.slotHolder ?? null,
        create: async (query: { data: Record<string, unknown> }) => {
          creates.push({ data: query.data });

          return buildVisitRow({
            id: "visit-new",
            routeItemId: query.data.routeItemId ?? null,
            clientVisitId: query.data.clientVisitId ?? null,
            startedAt: query.data.startedAt,
          });
        },
      },
    },
  };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    locationId: "location-a",
    representativeUserId: "rep-a",
    visitType: "field_visit",
    ...overrides,
  };
}

describe("offline visit start", () => {
  it("replays a client id by returning the visit it already created", async () => {
    const { prisma, creates } = buildPrisma({
      replayed: buildVisitRow({ id: "visit-first", clientVisitId: "cv-1" }),
    });
    const service = new VisitsService(prisma as never);

    const response = await service.createVisit(
      context as never,
      baseBody({ clientVisitId: "cv-1", routeItemId: "route-item-a" }) as never,
    );

    assert.equal(response.id, "visit-first");
    // Two visits for one stop is the failure this prevents: the rep has been
    // filling in the first one.
    assert.equal(creates.length, 0);
  });

  it("adopts the rep's own unfinished visit when the stop's slot is taken", async () => {
    // That visit *is* the work they were starting, so it is handed back and the
    // device re-keys its local records onto it.
    const { prisma, creates } = buildPrisma({
      slotHolder: buildVisitRow({
        id: "visit-open",
        status: "in_progress",
        representativeUserId: "rep-a",
      }),
    });
    const service = new VisitsService(prisma as never);

    const response = await service.createVisit(
      context as never,
      baseBody({ clientVisitId: "cv-2", routeItemId: "route-item-a" }) as never,
    );

    assert.equal(response.id, "visit-open");
    assert.equal(creates.length, 0);
  });

  it("creates an unlinked visit when the stop was already finished", async () => {
    // Adopting a completed visit would attach a fresh report to a closed one.
    // Dropping the route link is the same shape "start another visit" produces.
    for (const status of ["completed", "cancelled"]) {
      const { prisma, creates } = buildPrisma({
        slotHolder: buildVisitRow({ id: "visit-done", status }),
      });
      const service = new VisitsService(prisma as never);

      const response = await service.createVisit(
        context as never,
        baseBody({
          clientVisitId: `cv-${status}`,
          routeItemId: "route-item-a",
        }) as never,
      );

      assert.equal(response.id, "visit-new", `status ${status}`);
      assert.equal(creates.length, 1);
      assert.equal(
        creates[0].data.routeItemId,
        null,
        `a ${status} visit must not have its route link stolen`,
      );
    }
  });

  it("never adopts another representative's visit", async () => {
    // Same stop, someone else's unfinished visit. Handing it over would put this
    // rep's report on a colleague's visit.
    const { prisma, creates } = buildPrisma({
      slotHolder: buildVisitRow({
        id: "visit-colleague",
        status: "in_progress",
        representativeUserId: "rep-b",
      }),
    });
    const service = new VisitsService(prisma as never);

    const response = await service.createVisit(
      context as never,
      baseBody({ clientVisitId: "cv-3", routeItemId: "route-item-a" }) as never,
    );

    assert.equal(response.id, "visit-new");
    assert.equal(creates[0].data.routeItemId, null);
  });

  it("links the route item when the slot is free", async () => {
    const { prisma, creates } = buildPrisma({ slotHolder: null });
    const service = new VisitsService(prisma as never);

    await service.createVisit(
      context as never,
      baseBody({ clientVisitId: "cv-4", routeItemId: "route-item-a" }) as never,
    );

    assert.equal(creates[0].data.routeItemId, "route-item-a");
    assert.equal(creates[0].data.clientVisitId, "cv-4");
  });

  it("keeps working with no client id at all, exactly as before", async () => {
    const { prisma, creates } = buildPrisma({ slotHolder: null });
    const service = new VisitsService(prisma as never);

    await service.createVisit(
      context as never,
      baseBody({ routeItemId: "route-item-a" }) as never,
    );

    assert.equal(creates[0].data.clientVisitId, null);
    assert.equal(creates[0].data.routeItemId, "route-item-a");
  });

  it("records the moment the rep walked in, not the moment their signal returned", async () => {
    const { prisma, creates } = buildPrisma({ slotHolder: null });
    const service = new VisitsService(prisma as never);
    const walkedIn = new Date(Date.now() - 6 * 60 * 60 * 1000);

    await service.createVisit(
      context as never,
      baseBody({ startedAt: walkedIn.toISOString() }) as never,
    );

    assert.equal(
      (creates[0].data.startedAt as Date).toISOString(),
      walkedIn.toISOString(),
    );
  });

  it("refuses a start time no deferred send could honestly have", async () => {
    const service = new VisitsService(
      buildPrisma({ slotHolder: null }).prisma as never,
    );
    const tooOld = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const tooFarAhead = new Date(Date.now() + 3 * 60 * 60 * 1000);

    for (const startedAt of [tooOld, tooFarAhead]) {
      await assert.rejects(
        service.createVisit(
          context as never,
          baseBody({ startedAt: startedAt.toISOString() }) as never,
        ),
        (error: { response?: { code?: string } }) =>
          error.response?.code === "VISIT_STARTED_AT_OUT_OF_RANGE",
        `expected ${startedAt.toISOString()} to be refused`,
      );
    }
  });

  it("tolerates a phone clock a few minutes ahead", async () => {
    // Skew, not a lie worth refusing a rep's visit over.
    const { prisma, creates } = buildPrisma({ slotHolder: null });
    const service = new VisitsService(prisma as never);
    const slightlyAhead = new Date(Date.now() + 5 * 60 * 1000);

    await service.createVisit(
      context as never,
      baseBody({ startedAt: slightlyAhead.toISOString() }) as never,
    );

    assert.equal(
      (creates[0].data.startedAt as Date).toISOString(),
      slightlyAhead.toISOString(),
    );
  });

  it("rejects a client id that is not a short non-empty string", async () => {
    const service = new VisitsService(
      buildPrisma({ slotHolder: null }).prisma as never,
    );

    for (const clientVisitId of ["", "  ", 7, {}, [], true, "x".repeat(129)]) {
      await assert.rejects(
        service.createVisit(
          context as never,
          baseBody({ clientVisitId }) as never,
        ),
        (error: { response?: { code?: string } }) =>
          error.response?.code === "VISIT_CLIENT_ID_INVALID",
        `expected ${JSON.stringify(clientVisitId)} to be rejected`,
      );
    }
  });

  it("resolves a visit by the client id its URL was built from", async () => {
    // The only id a rep's phone had while offline, so every screen and every
    // write path has to accept it — otherwise the visit they are looking at
    // becomes a dead link the moment the create syncs.
    let queriedWhere: unknown = null;
    const prisma = {
      visit: {
        findFirst: async (query: { where: unknown }) => {
          queriedWhere = query.where;

          return buildVisitRow({ id: "visit-server", clientVisitId: "cv-5" });
        },
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisit(context as never, "cv-5");

    assert.equal(response.id, "visit-server");
    assert.deepEqual((queriedWhere as { OR: unknown }).OR, [
      { id: "cv-5" },
      { clientVisitId: "cv-5" },
    ]);
    // Still tenant-scoped: the client id is client input, and only the request
    // context says which tenant it may address.
    assert.equal((queriedWhere as { tenantId: string }).tenantId, "tenant-a");
  });
});
