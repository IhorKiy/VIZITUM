import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";
import {
  resolveVisitPeriodRange,
  VISIT_PERIOD_MAX_MONTHS,
  VisitsService,
} from "../src/modules/visits/visits.service";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    requestId: "request-a",
    tenantId: "tenant-a",
    tenantSlug: "tenant-a",
    userId: "manager-a",
    roleCodes: ["team_manager"],
    permissions: [PERMISSIONS.VISITS_READ_TEAM],
    ...overrides,
  } as RequestContext;
}

const now = new Date("2026-07-28T09:00:00.000Z");

// How deep a visit query may reach, and what the recap above the list counts.
// Both exist for the same reason: an unbounded visit list asks the database to
// sweep a tenant's whole history and then reports a number with no window
// behind it. The clamp is the backend half — it holds no matter which client
// asks, including old ones that send no period at all.
describe("visit period window", () => {
  it("floors a period-less query 12 months back from now instead of rejecting it", () => {
    const range = resolveVisitPeriodRange(undefined, undefined, now);

    // Start of that day, not the same clock time: the floor is a calendar
    // boundary like every other bound in this filter.
    assert.deepEqual(range, { gte: new Date("2025-07-28T00:00:00.000Z") });
    assert.equal(VISIT_PERIOD_MAX_MONTHS, 12);
  });

  it("keeps a period that already sits inside the ceiling exactly as asked", () => {
    const range = resolveVisitPeriodRange("2026-07-01", "2026-07-03", now);

    assert.deepEqual(range, {
      gte: new Date("2026-07-01T00:00:00.000Z"),
      lte: new Date("2026-07-03T23:59:59.999Z"),
    });
  });

  it("clamps a deeper start to 12 months back from the period's own end, not from now", () => {
    const range = resolveVisitPeriodRange("2019-01-01", "2024-06-30", now);

    // The end the caller asked for survives; only the start moves up, so an
    // old window stays where it was pointed rather than snapping to today.
    // The floor is the start of the boundary day: taking twelve months off an
    // end bound of 23:59:59.999 would otherwise leave a floor of 23:59:59.999
    // and drop all but the last millisecond of 30 June 2023.
    assert.deepEqual(range, {
      gte: new Date("2023-06-30T00:00:00.000Z"),
      lte: new Date("2024-06-30T23:59:59.999Z"),
    });
  });

  it("bounds a half-open period that only names its start", () => {
    const range = resolveVisitPeriodRange("2020-01-01", undefined, now);

    assert.deepEqual(range, { gte: new Date("2025-07-28T00:00:00.000Z") });
  });

  it("keeps the whole boundary day inside the window", () => {
    const range = resolveVisitPeriodRange("2000-01-01", "2026-07-28", now);
    // A visit at one minute past midnight on the floor day is in the window;
    // before the day was rounded down, only the final millisecond was.
    const firstMomentOfFloorDay = new Date("2025-07-28T00:01:00.000Z");

    assert.ok(range.gte.getTime() <= firstMomentOfFloorDay.getTime());
  });

  it("applies the floor to the list query even when the caller sent no dates", async () => {
    let capturedWhere:
      { AND: Array<{ OR: Array<{ startedAt?: { gte?: Date } }> }> } | undefined;
    const prisma = {
      visit: {
        findMany: async (query: { where: typeof capturedWhere }) => {
          capturedWhere = query.where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new VisitsService(prisma as never);

    const result = await service.listVisits(createContext(), {});

    const floor = capturedWhere?.AND[0].OR[0].startedAt?.gte;
    assert.ok(floor instanceof Date);
    // Within a year of now, give or take the second this test took to run.
    const monthsBack =
      (Date.now() - floor.getTime()) / (1000 * 60 * 60 * 24 * 365);
    assert.ok(monthsBack > 0.99 && monthsBack < 1.01);
    // The window is echoed back so a client can name what it is showing.
    assert.equal(result.period.startedFrom, floor.toISOString());
    assert.equal(result.period.startedTo, null);
  });

  it("counts the period by status ignoring the status filter, in the same request as the list", async () => {
    const capturedWheres: Array<{ status?: unknown }> = [];
    let groupByWhere: { status?: unknown } | undefined;
    const prisma = {
      visit: {
        findMany: async (query: { where: { status?: unknown } }) => {
          capturedWheres.push(query.where);
          return [];
        },
        count: async (query: { where: { status?: unknown } }) => {
          capturedWheres.push(query.where);
          return 4;
        },
        groupBy: async (query: { where: { status?: unknown } }) => {
          groupByWhere = query.where;
          return [
            { status: "completed", _count: { _all: 7 } },
            { status: "in_progress", _count: { _all: 2 } },
            { status: "cancelled", _count: { _all: 1 } },
            { status: "draft", _count: { _all: 1 } },
          ];
        },
      },
    };
    const service = new VisitsService(prisma as never);

    const result = await service.listVisits(createContext(), {
      status: ["completed"],
      startedFrom: "2026-07-01",
      startedTo: "2026-07-28",
    });

    // The list is narrowed by the pill; the recap above it is not — it is what
    // the pills are picked from.
    assert.equal(capturedWheres[0].status, "completed");
    assert.equal(groupByWhere?.status, undefined);
    assert.deepEqual(result.statusTotals, {
      total: 11,
      completed: 7,
      inProgress: 2,
      cancelled: 1,
    });
    // `total` stays the filtered count the pagination is built from.
    assert.equal(result.total, 4);
  });

  it("pins the list and its status totals to one window", async () => {
    const windows: Array<Date | undefined> = [];
    const capture = (where: {
      AND: Array<{ OR: Array<{ startedAt?: { gte?: Date } }> }>;
    }) => {
      windows.push(where.AND[0].OR[0].startedAt?.gte);
    };
    const prisma = {
      visit: {
        findMany: async (query: { where: Parameters<typeof capture>[0] }) => {
          capture(query.where);
          return [];
        },
        count: async () => 0,
        groupBy: async (query: { where: Parameters<typeof capture>[0] }) => {
          capture(query.where);
          return [];
        },
      },
    };
    const service = new VisitsService(prisma as never);

    await service.listVisits(createContext(), {});

    assert.equal(windows.length, 2);
    assert.deepEqual(windows[0], windows[1]);
  });
});
