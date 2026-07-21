import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportsService } from "../src/modules/imports/imports.service";

// applyInitialPlanImport is private — it's exercised here directly (bypassing
// the full validate/confirm job pipeline) the same way other services' tests
// call methods directly against a hand-built Prisma transaction mock.
type ApplyInitialPlanImport = (
  transaction: unknown,
  context: unknown,
  parsedFile: unknown,
  counts: unknown,
) => Promise<void>;

const tenantContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: [],
};

function buildRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    representative_email: "rep@example.com",
    location_external_code: "LOC-1",
    plan_date: "2026-08-05",
    ...overrides,
  };
}

function buildCounts() {
  return {
    users: 0,
    userRoles: 0,
    chains: 0,
    locationCategories: 0,
    locations: 0,
    locationAssignments: 0,
    contacts: 0,
    products: 0,
    routePlans: 0,
    routeItems: 0,
    tasks: 0,
  };
}

function callApplyInitialPlanImport(
  service: ImportsService,
  ...args: Parameters<ApplyInitialPlanImport>
): Promise<void> {
  return (
    service as unknown as { applyInitialPlanImport: ApplyInitialPlanImport }
  ).applyInitialPlanImport(...args);
}

describe("imports: initial plan row application", () => {
  it("reuses the same template-less route plan across rows for the same rep and date instead of creating a duplicate", async () => {
    // Imported plans are always template-less (routeTemplateId: null), so
    // the get-or-create in applyInitialPlanImport must find the plan the
    // first row just created for the second row on the same rep/date —
    // this is the rewritten lookup from routes.service.ts:createRoutePlan's
    // former compound-unique-key upsert (see the 20260721062916 migration).
    const routePlanCreateCalls: unknown[] = [];
    let routePlanFindFirstCallCount = 0;
    const transaction = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      location: {
        findFirst: async (args: { where: { externalCode: string } }) => ({
          id: args.where.externalCode === "LOC-1" ? "loc-1" : "loc-2",
        }),
      },
      routePlan: {
        findFirst: async () => {
          routePlanFindFirstCallCount += 1;
          return routePlanFindFirstCallCount === 1 ? null : { id: "plan-a" };
        },
        create: async (args: unknown) => {
          routePlanCreateCalls.push(args);
          return { id: "plan-a" };
        },
      },
      routeItem: {
        count: async () => 0,
        create: async () => ({ id: "item-x" }),
      },
    };
    const counts = buildCounts();
    const service = new ImportsService();

    await callApplyInitialPlanImport(
      service,
      transaction as never,
      tenantContext as never,
      {
        templateType: "initial_plan",
        columns: [],
        rows: [
          buildRow({ location_external_code: "LOC-1" }),
          buildRow({ location_external_code: "LOC-2" }),
        ],
      } as never,
      counts as never,
    );

    assert.equal(routePlanFindFirstCallCount, 2);
    assert.equal(routePlanCreateCalls.length, 1);
    assert.equal(counts.routePlans, 1);
    assert.equal(counts.routeItems, 2);
  });

  it("creates separate route plans for the same rep on different dates", async () => {
    const routePlanCreateCalls: Array<{ data: { planDate: Date } }> = [];
    const transaction = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      location: { findFirst: async () => ({ id: "loc-1" }) },
      routePlan: {
        findFirst: async () => null,
        create: async (args: { data: { planDate: Date } }) => {
          routePlanCreateCalls.push(args);
          return { id: `plan-${routePlanCreateCalls.length}` };
        },
      },
      routeItem: {
        count: async () => 0,
        create: async () => ({ id: "item-x" }),
      },
    };
    const counts = buildCounts();
    const service = new ImportsService();

    await callApplyInitialPlanImport(
      service,
      transaction as never,
      tenantContext as never,
      {
        templateType: "initial_plan",
        columns: [],
        rows: [
          buildRow({ plan_date: "2026-08-05" }),
          buildRow({ plan_date: "2026-08-06" }),
        ],
      } as never,
      counts as never,
    );

    assert.equal(routePlanCreateCalls.length, 2);
    assert.equal(counts.routePlans, 2);
    assert.notEqual(
      routePlanCreateCalls[0].data.planDate.toISOString(),
      routePlanCreateCalls[1].data.planDate.toISOString(),
    );
  });
});
