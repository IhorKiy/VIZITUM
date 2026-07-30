import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { VisitsService } from "../src/modules/visits/visits.service";

// A rep confirming a report in a dead zone never learns whether the request
// landed. The queued retry therefore has to be safe to send twice, which is what
// `clientRequestId` buys: the server recognises the replay and hands back the
// report the first attempt produced instead of doing the work again.
//
// Doing it again is specifically not harmless, which is what these tests pin: it
// would stamp a fresh `confirmedAt` — hours after the visit, for a rep who was
// offline when they finished it — and delete and recreate this report's tasks,
// throwing away whatever a manager had already done with the originals.

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "reports.confirm_own"],
};

const createdAt = new Date("2026-07-20T09:00:00.000Z");
const firstConfirmedAt = new Date("2026-07-20T14:30:00.000Z");

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

function buildStoredReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "report-a",
    tenantId: "tenant-a",
    visitId: "visit-a",
    locationId: "location-a",
    representativeUserId: "rep-a",
    templateCode: "distribution",
    schemaVersion: "manual.v1",
    status: "confirmed",
    confirmedData: { summary: "First attempt" },
    confirmedByUserId: "rep-a",
    confirmedAt: firstConfirmedAt,
    clientRequestId: "token-1",
    aiMetadata: { source: "manual_text" },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

// Prisma stub that records everything the confirm path touches, so a test can
// assert not only what came back but that the work was skipped.
function buildPrisma(options: {
  storedByToken?: Record<string, ReturnType<typeof buildStoredReport>>;
  transactionError?: unknown;
}) {
  const operations: string[] = [];
  const written: { create?: unknown; update?: unknown }[] = [];
  const storedByToken = options.storedByToken ?? {};

  return {
    operations,
    written,
    prisma: {
      visit: { findFirst: async () => buildVisit() },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      report: {
        findUnique: async ({
          where,
        }: {
          where: {
            tenantId_clientRequestId: {
              tenantId: string;
              clientRequestId: string;
            };
          };
        }) => {
          operations.push("reportLookup");

          const { tenantId, clientRequestId } = where.tenantId_clientRequestId;

          return tenantId === "tenant-a"
            ? (storedByToken[clientRequestId] ?? null)
            : null;
        },
      },
      task: { findMany: async () => [] },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) => {
        operations.push("transaction");

        if (options.transactionError) {
          throw options.transactionError;
        }

        return callback({
          report: {
            upsert: async (query: {
              create: { clientRequestId?: unknown };
              update: { clientRequestId?: unknown };
            }) => {
              operations.push("reportUpsert");
              written.push({ create: query.create, update: query.update });

              return buildStoredReport({
                clientRequestId: query.create.clientRequestId ?? null,
                confirmedAt: new Date("2026-07-21T20:00:00.000Z"),
              });
            },
          },
          visit: { update: async () => undefined },
          routeItem: { update: async () => undefined },
          task: {
            deleteMany: async () => {
              operations.push("taskDeleteMany");
            },
            createMany: async () => undefined,
          },
          storageObject: { updateMany: async () => undefined },
        });
      },
    },
  };
}

describe("report confirm idempotency", () => {
  it("replays a token by returning the first attempt's report, untouched", async () => {
    const { prisma, operations } = buildPrisma({
      storedByToken: { "token-1": buildStoredReport() },
    });
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "Second attempt, different text" },
      clientRequestId: "token-1",
    });

    assert.equal(response.id, "report-a");
    // The confirm time is the rep's original one, not the retry's. This is the
    // whole point: a report sent from a queue hours later must not claim it was
    // confirmed hours later.
    assert.equal(response.confirmedAt, firstConfirmedAt.toISOString());
    // And the work did not run again — no transaction, so no task churn.
    assert.deepEqual(operations, ["reportLookup"]);
  });

  it("replays a token even when the retried payload's visit date has since fallen outside the window", async () => {
    // The queue can flush days after the rep confirmed, replaying the exact
    // payload the first attempt already accepted. Re-validating it against
    // today's ±window would 400 a report that already exists — the rep would
    // be told to fix a visit that is completed and locked, a dead end. The
    // replay lookup has to run before that validation, not after.
    const { prisma, operations } = buildPrisma({
      storedByToken: { "token-1": buildStoredReport() },
    });
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      schemaVersion: "field-report.v1",
      confirmedData: {
        summary: "Replayed after the window closed",
        fieldReport: { visitDate: "2020-01-01" },
      },
      clientRequestId: "token-1",
    });

    assert.equal(response.id, "report-a");
    // No transaction, and — the point of this test — no visit-date rejection
    // either: the lookup answered before validation ever ran.
    assert.deepEqual(operations, ["reportLookup"]);
  });

  it("does the work when the token is new", async () => {
    const { prisma, operations } = buildPrisma({ storedByToken: {} });
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "First attempt" },
      clientRequestId: "token-fresh",
    });

    assert.equal(response.id, "report-a");
    assert.ok(operations.includes("transaction"));
    assert.ok(operations.includes("reportUpsert"));
  });

  it("writes the token on both sides of the upsert, or nothing could match it later", async () => {
    const { prisma, written } = buildPrisma({ storedByToken: {} });
    const service = new VisitsService(prisma as never);

    await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "First attempt" },
      clientRequestId: "  token-fresh  ",
    });

    assert.equal(written.length, 1);
    // Both branches: a first confirm creates the row, a re-confirm of the same
    // visit updates it, and a token written on only one of them would leave the
    // other unreplayable.
    assert.equal(
      (written[0].create as { clientRequestId: string }).clientRequestId,
      "token-fresh",
    );
    assert.equal(
      (written[0].update as { clientRequestId: string }).clientRequestId,
      "token-fresh",
    );
  });

  it("writes null rather than an empty token when none was sent", async () => {
    const { prisma, written } = buildPrisma({ storedByToken: {} });
    const service = new VisitsService(prisma as never);

    await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "No token" },
    });

    // Not "": the uniqueness only tolerates unlimited NULLs, so an empty string
    // would collide the second time any tokenless confirm happened in a tenant.
    assert.equal(
      (written[0].create as { clientRequestId: unknown }).clientRequestId,
      null,
    );
  });

  it("keeps working with no token at all, exactly as before", async () => {
    const { prisma, operations } = buildPrisma({ storedByToken: {} });
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "No token" },
    });

    assert.equal(response.id, "report-a");
    // No lookup is even attempted — an absent token must not cost a query.
    assert.equal(operations.includes("reportLookup"), false);
    assert.ok(operations.includes("transaction"));
  });

  it("refuses a token already spent on another visit", async () => {
    // Replaying another visit's report as this one's would be worse than any
    // error, so this is a conflict rather than a silent pass-through.
    const { prisma } = buildPrisma({
      storedByToken: {
        "token-1": buildStoredReport({
          visitId: "visit-elsewhere",
          id: "report-elsewhere",
        }),
      },
    });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.confirmReport(context as never, "visit-a", {
        confirmedData: { summary: "Reused token" },
        clientRequestId: "token-1",
      }),
      (error: { response?: { code?: string }; status?: number }) =>
        error.response?.code === "REPORT_REQUEST_ID_REUSED",
    );
  });

  it("rejects a token that is not a short non-empty string", async () => {
    const service = new VisitsService(
      buildPrisma({ storedByToken: {} }).prisma as never,
    );

    for (const clientRequestId of [
      "",
      "   ",
      42,
      {},
      [],
      true,
      "x".repeat(129),
    ]) {
      await assert.rejects(
        service.confirmReport(context as never, "visit-a", {
          confirmedData: { summary: "Bad token" },
          clientRequestId,
        }),
        (error: { response?: { code?: string } }) =>
          error.response?.code === "REPORT_REQUEST_ID_INVALID",
        `expected ${JSON.stringify(clientRequestId)} to be rejected`,
      );
    }
  });

  it("hands the winner's report to the loser of a race", async () => {
    // Two flushes of the same queued confirm can pass the lookup together; the
    // unique index decides, and the loser must not get a 500 it would only
    // retry into.
    const { prisma, operations } = buildPrisma({
      storedByToken: {},
      transactionError: new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test" },
      ),
    });

    // The winner's row exists by the time the loser looks again.
    let lookups = 0;
    const racingPrisma = {
      ...prisma,
      report: {
        findUnique: async () => {
          lookups += 1;
          operations.push("reportLookup");

          return lookups === 1 ? null : buildStoredReport();
        },
      },
    };
    const service = new VisitsService(racingPrisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData: { summary: "Raced" },
      clientRequestId: "token-1",
    });

    assert.equal(response.id, "report-a");
    assert.equal(response.confirmedAt, firstConfirmedAt.toISOString());
  });

  it("still surfaces a unique violation that is not the token's", async () => {
    // Without a token there is nothing to replay, so a P2002 from anywhere else
    // in the transaction must keep propagating instead of being swallowed.
    const { prisma } = buildPrisma({
      storedByToken: {},
      transactionError: new Prisma.PrismaClientKnownRequestError(
        "Unique constraint failed",
        { code: "P2002", clientVersion: "test" },
      ),
    });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.confirmReport(context as never, "visit-a", {
        confirmedData: { summary: "No token" },
      }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );
  });
});
