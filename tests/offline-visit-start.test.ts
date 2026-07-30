import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { AiService } from "../src/modules/ai/ai.service";
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
  // Thrown from `create`, so a test can force the race branch. Real callers
  // never see the raced lookup unless this is a P2002 with a clientVisitId
  // in play — see the two `findUnique` calls below.
  createError?: unknown;
  // What the *second* `findUnique` call (the post-P2002 raced lookup) finds.
  // The first call is always the pre-create replay lookup, which every race
  // test here means to miss.
  racedVisit?: ReturnType<typeof buildVisitRow> | null;
  // What the alias table answers for the incoming client id, and the visit it
  // points at — the second half of the replay lookup, for an id recorded by an
  // adopt rather than written onto a row by a create.
  alias?: { visitId: string } | null;
  aliasTarget?: ReturnType<typeof buildVisitRow> | null;
} = {}) {
  const creates: { data: Record<string, unknown> }[] = [];
  const aliasCreates: {
    data: Record<string, unknown>[];
    skipDuplicates?: boolean;
  }[] = [];
  let findUniqueCalls = 0;

  return {
    creates,
    aliasCreates,
    prisma: {
      location: { findFirst: async () => ({ id: "location-a" }) },
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routeItem: { findFirst: async () => ({ id: "route-item-a" }) },
      visitClientAlias: {
        findUnique: async () => options.alias ?? null,
        createMany: async (query: {
          data: Record<string, unknown>[];
          skipDuplicates?: boolean;
        }) => {
          aliasCreates.push(query);

          return { count: query.data.length };
        },
      },
      visit: {
        findUnique: async () => {
          findUniqueCalls += 1;

          return findUniqueCalls === 1
            ? (options.replayed ?? null)
            : (options.racedVisit ?? null);
        },
        // Two different questions reach the same stub: resolving the stop's
        // slot holder asks by `routeItemId`, resolving an alias asks by `id`.
        findFirst: async (query: { where: Record<string, unknown> }) =>
          "id" in query.where
            ? (options.aliasTarget ?? null)
            : (options.slotHolder ?? null),
        create: async (query: { data: Record<string, unknown> }) => {
          creates.push({ data: query.data });

          if (options.createError) {
            throw options.createError;
          }

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

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
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

  it("hands the winner's visit to the loser of a clientVisitId race", async () => {
    // The replay lookup and the create are not atomic: two concurrent
    // deferred starts with the same clientVisitId can both miss the lookup
    // and race the unique index. The loser must not get a 500 it would only
    // retry into.
    const { prisma, creates } = buildPrisma({
      slotHolder: null,
      createError: p2002(),
      racedVisit: buildVisitRow({
        id: "visit-winner",
        clientVisitId: "cv-race",
      }),
    });
    const service = new VisitsService(prisma as never);

    const response = await service.createVisit(
      context as never,
      baseBody({
        clientVisitId: "cv-race",
        routeItemId: "route-item-a",
      }) as never,
    );

    assert.equal(response.id, "visit-winner");
    assert.equal(creates.length, 1);
  });

  it("still surfaces a P2002 that is not the client id's", async () => {
    // Without a client id in play there is nothing to replay, so a P2002 from
    // anywhere in the create — including the separate routeItemId unique
    // constraint — must keep propagating instead of being swallowed.
    const { prisma } = buildPrisma({
      slotHolder: null,
      createError: p2002(),
    });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.createVisit(
        context as never,
        baseBody({ routeItemId: "route-item-a" }) as never,
      ),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });

  it("also surfaces the P2002 when a client id is in play but did not cause it", async () => {
    // The route-slot race (both callers saw the stop's slot free) raises the
    // same P2002 code as a clientVisitId collision. With a client id in play
    // the raced lookup does run, but finds nothing to replay — so this must
    // still rethrow rather than silently swallow a real error.
    const { prisma } = buildPrisma({
      slotHolder: null,
      createError: p2002(),
      racedVisit: null,
    });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.createVisit(
        context as never,
        baseBody({
          clientVisitId: "cv-not-the-cause",
          routeItemId: "route-item-a",
        }) as never,
      ),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
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

  it("records the adopting client id so a lost response can find this visit again", async () => {
    // A retry that never learned this same adopt's answer at all (the
    // response itself got lost, not just the client's own rekey) would
    // otherwise re-evaluate the route slot from scratch every time, since
    // adopting creates no row of its own to carry the id the device minted.
    // Recording it is what lets the next retry find this visit through the
    // ordinary replay lookup instead — even if it closes in the meantime.
    const { prisma, aliasCreates } = buildPrisma({
      slotHolder: buildVisitRow({
        id: "visit-open",
        status: "in_progress",
        representativeUserId: "rep-a",
        clientVisitId: null,
      }),
    });
    const service = new VisitsService(prisma as never);

    await service.createVisit(
      context as never,
      baseBody({ clientVisitId: "cv-2", routeItemId: "route-item-a" }) as never,
    );

    assert.equal(aliasCreates.length, 1);
    assert.deepEqual(aliasCreates[0].data, [
      { tenantId: "tenant-a", visitId: "visit-open", clientVisitId: "cv-2" },
    ]);
    // The duplicate case is the database's to settle, not a try/catch's: a
    // concurrent retry recording the same id first is skipped rather than
    // failing an adopt that has already succeeded.
    assert.equal(aliasCreates[0].skipDuplicates, true);
  });

  it("records a second adopter's id beside the first rather than dropping it", async () => {
    // The gap this table exists to close. Two devices, or two retries whose
    // responses were both lost, can reach the same still-open visit carrying
    // two different minted ids. A single column on the visit takes only the
    // first, and the second is then unrecoverable — its own retry finds
    // nothing to replay onto and, if the visit has closed by then, mints a
    // duplicate for a stop already done.
    const { prisma, aliasCreates } = buildPrisma({
      slotHolder: buildVisitRow({
        id: "visit-open",
        status: "in_progress",
        representativeUserId: "rep-a",
        clientVisitId: "cv-first",
      }),
    });
    const service = new VisitsService(prisma as never);

    const response = await service.createVisit(
      context as never,
      baseBody({
        clientVisitId: "cv-second",
        routeItemId: "route-item-a",
      }) as never,
    );

    assert.equal(response.id, "visit-open");
    assert.equal(aliasCreates.length, 1);
    assert.deepEqual(aliasCreates[0].data, [
      {
        tenantId: "tenant-a",
        visitId: "visit-open",
        clientVisitId: "cv-second",
      },
    ]);
  });

  it("replays a client id an adopt recorded, without re-deriving the route slot", async () => {
    // The other half of the same fix: the retry. Nothing was created under
    // this id, so the visit row itself carries no trace of it — the alias is
    // the only thing that can answer, and answering from it is what keeps
    // this retry from looking at the stop's slot a second time.
    const { prisma, creates } = buildPrisma({
      alias: { visitId: "visit-open" },
      aliasTarget: buildVisitRow({ id: "visit-open", status: "completed" }),
      // The slot's own holder is deliberately absent: reaching
      // resolveRouteItemLink at all would mean the replay lookup missed.
      slotHolder: null,
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
    // becomes a dead link the moment the create syncs. The `id` lookup tried
    // first finds nothing for a client-minted id, so this also exercises the
    // fallback query.
    const queriedWheres: unknown[] = [];
    const prisma = {
      visit: {
        findFirst: async (query: { where: unknown }) => {
          queriedWheres.push(query.where);

          return queriedWheres.length === 1
            ? null
            : buildVisitRow({ id: "visit-server", clientVisitId: "cv-5" });
        },
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisit(context as never, "cv-5");

    assert.equal(response.id, "visit-server");
    // Both queries tenant-scoped: the id is client input, and only the
    // request context says which tenant it may address. The `id` query runs
    // first and only the fallback carries `clientVisitId`.
    assert.deepEqual(queriedWheres, [
      { tenantId: "tenant-a", id: "cv-5" },
      { tenantId: "tenant-a", clientVisitId: "cv-5" },
    ]);
  });

  it("returns the id match over another visit's clientVisitId collision", async () => {
    // clientVisitId is client input — a device (or a malicious rep) can mint
    // one equal to another visit's real server id. The id match must always
    // win, and the clientVisitId query must never even run once it has.
    let clientVisitIdQueried = false;
    const prisma = {
      visit: {
        findFirst: async (query: {
          where: { tenantId: string; id?: string; clientVisitId?: string };
        }) => {
          if ("clientVisitId" in query.where) {
            clientVisitIdQueried = true;

            return buildVisitRow({
              id: "visit-impostor",
              clientVisitId: "visit-real",
            });
          }

          return buildVisitRow({ id: "visit-real", clientVisitId: null });
        },
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisit(context as never, "visit-real");

    assert.equal(response.id, "visit-real");
    assert.equal(clientVisitIdQueried, false);
  });

  it("resolves a visit by a client id an adopt recorded, once both direct lookups miss", async () => {
    // The URL a second adopter's phone is standing on. Nothing was created
    // under that id, so no visit row carries it — without the alias the
    // screen the rep is looking at is a dead link until their own rekey
    // lands, which is exactly the window a lost response leaves open.
    const queriedWheres: unknown[] = [];
    const prisma = {
      visit: {
        findFirst: async (query: { where: Record<string, unknown> }) => {
          queriedWheres.push(query.where);

          return query.where.id === "visit-open"
            ? buildVisitRow({ id: "visit-open" })
            : null;
        },
      },
      visitClientAlias: {
        findUnique: async () => ({ visitId: "visit-open" }),
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisit(context as never, "cv-8");

    assert.equal(response.id, "visit-open");
    // Tried last, and only ever reached by an id no visit answers to
    // directly — so a real server id can never be outvoted by client input,
    // the same ordering rule the two queries above already hold.
    assert.deepEqual(queriedWheres, [
      { tenantId: "tenant-a", id: "cv-8" },
      { tenantId: "tenant-a", clientVisitId: "cv-8" },
      { tenantId: "tenant-a", id: "visit-open" },
    ]);
  });
});

// The id is only useful if it works everywhere the rep's phone puts it in a URL,
// and the AI endpoints sit under the same `/visits/:visitId` prefix. They used
// to match on `id` alone, so a visit started with no signal transcribed nothing
// once the rep got signal back — and silently, since the form treats a failed
// transcription as "fill it in manually" rather than as an error worth showing.
describe("AI endpoints resolve either visit id", () => {
  const aiContext = {
    ...context,
    permissions: [...context.permissions, "ai.use_reporting"],
  };

  it("transcribes a field report for a visit addressed by its client id", async () => {
    // The voice path of the field report form, which is the one a rep reaches
    // straight after starting a visit offline. Getting past the visit lookup is
    // the whole assertion — the audio object is deliberately absent, so the
    // error that does come back proves the visit itself resolved.
    const queriedWheres: unknown[] = [];
    const prisma = {
      visit: {
        findFirst: async (query: { where: unknown }) => {
          queriedWheres.push(query.where);

          return queriedWheres.length === 1
            ? null
            : { id: "visit-server", representativeUserId: "rep-a" };
        },
      },
      storageObject: { findFirst: async () => null },
    };
    const service = new AiService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await assert.rejects(
      service.transcribeFieldReport(aiContext as never, "cv-6", {
        audioObjectId: "audio-a",
        products: [],
      }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "TRANSCRIPTION_INPUT_INVALID",
    );
    assert.deepEqual(queriedWheres, [
      { tenantId: "tenant-a", id: "cv-6" },
      { tenantId: "tenant-a", clientVisitId: "cv-6" },
    ]);
  });

  it("looks an extraction job up by the visit's server id, not the id the caller sent", async () => {
    // The subtle half. `AiJob.visitId` holds the server's own id, so resolving
    // the visit is not enough — the job query has to use what the resolution
    // returned. Matching it against the client id would find nothing and read
    // as "no succeeded transcription", for a job sitting right there.
    let jobWhere: { visitId?: string } | null = null;
    const prisma = {
      visit: {
        findFirst: async (query: { where: { clientVisitId?: string } }) =>
          query.where.clientVisitId
            ? {
                id: "visit-server",
                representativeUserId: "rep-a",
                location: { id: "location-a", name: "Location A" },
              }
            : null,
      },
      aiJob: {
        findFirst: async (query: { where: { visitId?: string } }) => {
          jobWhere = query.where;

          return null;
        },
      },
    };
    const service = new AiService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await assert.rejects(
      service.createExtractionJob(aiContext as never, "cv-7", "job-a"),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "EXTRACTION_INPUT_INVALID",
    );
    assert.equal(
      (jobWhere as { visitId?: string } | null)?.visitId,
      "visit-server",
    );
  });
});
