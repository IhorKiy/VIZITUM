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

function createFakePrisma(options: {
  timezone?: string | null;
  rows: FakeSummaryRow[];
}) {
  const queryRawCalls: Prisma.Sql[] = [];
  const prisma = {
    platformTenant: {
      findUnique: async () =>
        options.timezone === null ? null : { timezone: options.timezone },
    },
    $queryRaw: async (query: Prisma.Sql) => {
      queryRawCalls.push(query);
      return options.rows;
    },
  };

  return { prisma, queryRawCalls };
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
    const { prisma, queryRawCalls } = createFakePrisma({
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

    // No findMany/count fallback: exactly one aggregate query, never a
    // row-per-visit fetch — see the "unbounded team-scope read" note on
    // getVisitDaySummary.
    assert.equal(queryRawCalls.length, 1);
    // [timezone, tenantId, representativeUserId] — the SELECT's day
    // expression binds the timezone before the WHERE clause's own values.
    assert.deepEqual(queryRawCalls[0].values, [
      "Europe/Kyiv",
      "tenant-a",
      "rep-a",
    ]);
  });

  it("applies the status and started-date filters with no representative condition for a team-scope caller", async () => {
    const { prisma, queryRawCalls } = createFakePrisma({
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

    assert.equal(queryRawCalls.length, 1);
    assert.deepEqual(queryRawCalls[0].values, [
      "Europe/Kyiv",
      "tenant-a",
      "completed",
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-02T23:59:59.999Z"),
    ]);
  });

  it("binds every value of a multi-status filter into the IN-list", async () => {
    const { prisma, queryRawCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      rows: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_TEAM] }),
      { status: ["draft", "in_progress"] },
    );

    assert.equal(queryRawCalls.length, 1);
    assert.deepEqual(queryRawCalls[0].values, [
      "Europe/Kyiv",
      "tenant-a",
      "draft",
      "in_progress",
    ]);
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
