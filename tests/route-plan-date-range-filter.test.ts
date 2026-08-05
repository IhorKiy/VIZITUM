import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RoutesService } from "../src/modules/routes/routes.service";

// `GET /routes` grew `planDateFrom`/`planDateTo` so the week planner can ask
// for exactly the seven days it draws. Before that the screen requested the
// representative's 100 most recent plans and filtered them in the page, which
// silently emptied any week that had fallen out of that window — and the
// window shrinks the more templates a rep assigns per day, since a day can
// hold several plans.
//
// What matters is the `where` the service builds, so prisma is a spy: these
// tests assert the filter, not the rows.

const representativeContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_OWN],
};

const noopAudit = { recordEvent: async () => {} };

function buildService() {
  const calls: Record<string, unknown>[] = [];
  const prisma = {
    routePlan: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        return [];
      },
      count: async () => 0,
    },
  };

  return {
    calls,
    service: new RoutesService(
      prisma as never,
      noopAudit as never,
    ) as RoutesService,
  };
}

async function whereFor(query: Record<string, unknown>) {
  const { service, calls } = buildService();

  await service.listRoutes(representativeContext as never, query as never);

  return (calls[0] as { where: Record<string, unknown> }).where;
}

describe("GET /routes plan date filtering", () => {
  it("filters on an inclusive window when both ends are given", async () => {
    const where = await whereFor({
      representativeUserId: "rep-a",
      planDateFrom: "2026-08-03",
      planDateTo: "2026-08-09",
    });

    assert.deepEqual(where.planDate, {
      gte: new Date("2026-08-03T00:00:00.000Z"),
      lte: new Date("2026-08-09T00:00:00.000Z"),
    });
  });

  it("accepts either end on its own", async () => {
    const fromOnly = await whereFor({
      representativeUserId: "rep-a",
      planDateFrom: "2026-08-03",
    });
    assert.deepEqual(fromOnly.planDate, {
      gte: new Date("2026-08-03T00:00:00.000Z"),
    });

    const toOnly = await whereFor({
      representativeUserId: "rep-a",
      planDateTo: "2026-08-09",
    });
    assert.deepEqual(toOnly.planDate, {
      lte: new Date("2026-08-09T00:00:00.000Z"),
    });
  });

  it("lets an exact planDate win over a range, rather than intersecting the two", async () => {
    const where = await whereFor({
      representativeUserId: "rep-a",
      planDate: "2026-08-06",
      planDateFrom: "2026-08-03",
      planDateTo: "2026-08-09",
    });

    assert.deepEqual(where.planDate, new Date("2026-08-06T00:00:00.000Z"));
  });

  it("applies no date filter when neither is asked for", async () => {
    const where = await whereFor({ representativeUserId: "rep-a" });

    assert.equal("planDate" in where, false);
  });

  it("rejects a malformed range end instead of quietly dropping the filter", async () => {
    // A dropped filter would answer with the representative's whole history,
    // which the caller renders as if it were the week it asked for.
    const { service } = buildService();

    await assert.rejects(
      service.listRoutes(representativeContext as never, {
        representativeUserId: "rep-a",
        planDateFrom: "2026-02-31",
      } as never),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "DATE_INVALID",
    );
  });

  it("keeps the tenant and representative scoping the range filter sits beside", async () => {
    const where = await whereFor({
      representativeUserId: "rep-a",
      planDateFrom: "2026-08-03",
      planDateTo: "2026-08-09",
    });

    assert.equal(where.tenantId, "tenant-a");
    assert.equal(where.representativeUserId, "rep-a");
  });
});
