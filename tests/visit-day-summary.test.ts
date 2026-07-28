import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";
import { VisitsService } from "../src/modules/visits/visits.service";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    requestId: "request-a",
    tenantId: "tenant-a",
    tenantSlug: "tenant-a",
    userId: "rep-a",
    roleCodes: ["field_representative"],
    permissions: [PERMISSIONS.VISITS_READ_OWN],
    ...overrides,
  } as RequestContext;
}

type FakeSummaryRow = {
  day: string;
  total: bigint;
  completed: bigint;
  cancelled: bigint;
};

// The two raw queries the endpoint runs are told apart by their shape: the
// day aggregate GROUP BYs, the history boundary is a bare MIN.
function isHistoryBoundaryQuery(query: Prisma.Sql): boolean {
  return query.strings.join("").includes("MIN(");
}

function createFakePrisma(options: {
  timezone?: string | null;
  rows: FakeSummaryRow[];
  historyStart?: Date | null;
}) {
  const queryRawCalls: Prisma.Sql[] = [];
  const prisma = {
    platformTenant: {
      findUnique: async () =>
        options.timezone === null ? null : { timezone: options.timezone },
    },
    $queryRaw: async (query: Prisma.Sql) => {
      queryRawCalls.push(query);

      return isHistoryBoundaryQuery(query)
        ? [{ historyStart: options.historyStart ?? null }]
        : options.rows;
    },
  };

  return {
    prisma,
    queryRawCalls,
    daySummaryCalls: () =>
      queryRawCalls.filter((q) => !isHistoryBoundaryQuery(q)),
    historyCalls: () => queryRawCalls.filter(isHistoryBoundaryQuery),
  };
}

// The COALESCE(startedAt, createdAt)/timezone-bucketing itself, the same
// COALESCE fallback on the started-date range filter, and the multi-status
// IN-list all run as SQL inside getVisitDaySummary (see the comments there),
// so — unlike the query-construction and response-mapping behavior below —
// none of it is exercised by this mocked-Prisma suite; it was verified by
// hand against the real local Postgres since this repo's tests never hit a
// live database.
describe("visit day summary", () => {
  it("maps aggregated rows (bigint totals, YYYY-MM-DD day text) into the response shape", async () => {
    const { prisma } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [
        { day: "2026-07-02", total: 2n, completed: 2n, cancelled: 0n },
        { day: "2026-07-01", total: 3n, completed: 0n, cancelled: 1n },
      ],
    });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(createContext(), {});

    // `cancelled` rides along with `total`/`completed` so the history list can
    // take a day's completion share over the visits that were actually
    // workable, rather than counting a cancelled visit as one left undone.
    assert.deepEqual(summary.days, [
      { day: "2026-07-02", total: 2, completed: 2, cancelled: 0 },
      { day: "2026-07-01", total: 3, completed: 0, cancelled: 1 },
    ]);
  });

  it("returns no days for an empty result set", async () => {
    const { prisma } = createFakePrisma({ timezone: "Europe/Kyiv", rows: [] });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(createContext(), {});

    assert.deepEqual(summary.days, []);
  });

  it("aggregates in a single query scoped to the caller's own visits and the tenant timezone, when only visits.read_own is held", async () => {
    const { prisma, daySummaryCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({
        permissions: [PERMISSIONS.VISITS_READ_OWN],
        userId: "rep-a",
      }),
      {},
    );

    // No findMany/count fallback: the days come from exactly one aggregate
    // query, never a row-per-visit fetch — see the "unbounded team-scope read"
    // note on getVisitDaySummary.
    assert.equal(daySummaryCalls().length, 1);
    // [timezone, tenantId, representativeUserId, periodFloor] — the SELECT's
    // day expression binds the timezone before the WHERE clause's own values,
    // and the floor is always there: a request with no period still groups
    // over a bounded window rather than the tenant's whole history.
    const values = daySummaryCalls()[0].values;
    assert.deepEqual(values.slice(0, 3), ["Europe/Kyiv", "tenant-a", "rep-a"]);
    assert.equal(values.length, 4);
    assert.ok(values[3] instanceof Date);
  });

  it("applies the status and started-date filters with no representative condition for a team-scope caller", async () => {
    const { prisma, daySummaryCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_TEAM] }),
      {
        status: ["completed"],
        startedFrom: "2026-07-01",
        startedTo: "2026-07-02",
      },
    );

    assert.equal(daySummaryCalls().length, 1);
    assert.deepEqual(daySummaryCalls()[0].values, [
      "Europe/Kyiv",
      "tenant-a",
      "completed",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-02T23:59:59.999Z"),
    ]);
  });

  it("binds every value of a multi-status filter into the IN-list", async () => {
    const { prisma, daySummaryCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_TEAM] }),
      { status: ["draft", "in_progress"] },
    );

    assert.equal(daySummaryCalls().length, 1);
    const values = daySummaryCalls()[0].values;
    assert.deepEqual(values.slice(0, 4), [
      "Europe/Kyiv",
      "tenant-a",
      "draft",
      "in_progress",
    ]);
    // The clamped period floor closes the WHERE clause.
    assert.equal(values.length, 5);
    assert.ok(values[4] instanceof Date);
  });

  // Where the history begins is the one fact a windowed aggregate can never
  // report, and the difference between two very different things the field
  // history screen has to say: "there is nothing older than this window" and
  // "this window is empty, keep walking back".
  it("reports the earliest visit in scope, unbounded by the window, alongside the days", async () => {
    const { prisma, historyCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
      historyStart: new Date("2024-03-05T08:15:00.000Z"),
    });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_OWN] }),
      { startedFrom: "2026-07-01", startedTo: "2026-07-31" },
    );

    assert.equal(summary.historyStart, "2024-03-05T08:15:00.000Z");
    assert.equal(historyCalls().length, 1);
    // Scope without window: tenant and representative are bound, neither end
    // of the period is — a boundary that respected the window could only ever
    // answer with the window's own edge.
    assert.deepEqual(historyCalls()[0].values, ["tenant-a", "rep-a"]);
  });

  it("carries every scope filter into the history boundary, so it answers for the same visits the days describe", async () => {
    const { prisma, historyCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
      historyStart: new Date("2025-01-02T00:00:00.000Z"),
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_TEAM] }),
      {
        locationId: "location-a",
        status: ["completed"],
        startedFrom: "2026-07-01",
      },
    );

    assert.deepEqual(historyCalls()[0].values, [
      "tenant-a",
      "location-a",
      "completed",
    ]);
  });

  it("reports no boundary at all for a scope that holds no visits", async () => {
    const { prisma } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
      historyStart: null,
    });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(createContext(), {});

    // A valid answer, not a failure: this history has no floor to reach.
    assert.equal(summary.historyStart, null);
    assert.deepEqual(summary.days, []);
  });

  it("rejects when the tenant cannot be resolved", async () => {
    const { prisma } = createFakePrisma({ timezone: null, rows: [] });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      () => service.getVisitDaySummary(createContext(), {}),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_INVALID",
        );
        return true;
      },
    );
  });
});
