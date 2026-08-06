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
    const routePlanCreateCalls: { data: unknown[] }[] = [];
    let routePlanFindManyCallCount = 0;
    let routeItemCreateManyCallCount = 0;
    const transaction = {
      user: {
        findMany: async () => [{ id: "rep-a", email: "rep@example.com" }],
      },
      location: {
        findMany: async (args: {
          where: { externalCode: { in: string[] } };
        }) =>
          args.where.externalCode.in.map((externalCode) => ({
            id: externalCode === "loc-1" ? "loc-1" : "loc-2",
            externalCode,
          })),
      },
      routePlan: {
        findMany: async () => {
          routePlanFindManyCallCount += 1;
          return [];
        },
        createManyAndReturn: async (args: {
          data: {
            representativeUserId: string;
            planDate: Date;
          }[];
        }) => {
          routePlanCreateCalls.push(args);

          return args.data.map((plan, index) => ({
            id: `plan-${index + 1}`,
            representativeUserId: plan.representativeUserId,
            planDate: plan.planDate,
          }));
        },
      },
      routeItem: {
        groupBy: async () => [],
        createMany: async () => {
          routeItemCreateManyCallCount += 1;

          return { count: 2 };
        },
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

    // One lookup and one insert for the whole file rather than a pair a row,
    // and the two rows still collapse onto a single plan because they share a
    // representative and a date (audit F8 batched this; the reuse is the
    // behaviour that had to survive it).
    assert.equal(routePlanFindManyCallCount, 1);
    assert.equal(routePlanCreateCalls.length, 1);
    assert.equal(routePlanCreateCalls[0]?.data.length, 1);
    assert.equal(routeItemCreateManyCallCount, 1);
    assert.equal(counts.routePlans, 1);
    assert.equal(counts.routeItems, 2);
  });

  it("creates separate route plans for the same rep on different dates", async () => {
    const routePlanCreateCalls: Array<{ data: { planDate: Date }[] }> = [];
    const transaction = {
      user: {
        findMany: async () => [{ id: "rep-a", email: "rep@example.com" }],
      },
      location: {
        findMany: async () => [{ id: "loc-1", externalCode: "loc-1" }],
      },
      routePlan: {
        findMany: async () => [],
        createManyAndReturn: async (args: {
          data: { representativeUserId: string; planDate: Date }[];
        }) => {
          routePlanCreateCalls.push(args);

          return args.data.map((plan, index) => ({
            id: `plan-${index + 1}`,
            representativeUserId: plan.representativeUserId,
            planDate: plan.planDate,
          }));
        },
      },
      routeItem: {
        groupBy: async () => [],
        createMany: async () => ({ count: 2 }),
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

    // Both plans are created by the one batched insert, and the two dates stay
    // distinct within it.
    assert.equal(routePlanCreateCalls.length, 1);
    assert.equal(routePlanCreateCalls[0].data.length, 2);
    assert.equal(counts.routePlans, 2);
    assert.notEqual(
      routePlanCreateCalls[0].data[0].planDate.toISOString(),
      routePlanCreateCalls[0].data[1].planDate.toISOString(),
    );
  });
});
