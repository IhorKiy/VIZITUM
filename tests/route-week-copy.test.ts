import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RouteTemplatesService } from "../src/modules/routes/route-templates.service";

// `POST /routes/templates/copy-week` fills next week from the week the
// planner is showing, the way copy-month fills this month from the last one.
// Two things separate it from its month sibling: it copies *forward* (so both
// ends are named rather than one being inferred), and every source day has a
// counterpart — a week is always seven days — so the only reason to skip is a
// (date, template) pair the target week already holds.

const representativeContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_OWN],
};

const noopAudit = { recordEvent: async () => {} };

const timestamp = new Date("2026-08-01T00:00:00.000Z");

type SourcePlan = { planDate: string; routeTemplateId: string };

/**
 * `plansByWeekStart` is keyed by the Monday each window opens on — the source
 * and target weeks are fetched in the same `Promise.all`, so the `gte` of the
 * incoming query is what tells them apart.
 */
function buildService(plansByWeekStart: Record<string, SourcePlan[]>) {
  const templateIds = [
    ...new Set(
      Object.values(plansByWeekStart)
        .flat()
        .map((plan) => plan.routeTemplateId),
    ),
  ];
  // Every plan the copy actually wrote, as `date::template`.
  const created: string[] = [];

  const prisma = {
    routePlan: {
      findMany: async (args: {
        where: { planDate: { gte: Date; lt: Date } };
      }) => {
        const weekStart = args.where.planDate.gte.toISOString().slice(0, 10);

        return (plansByWeekStart[weekStart] ?? []).map((plan) => ({
          planDate: new Date(`${plan.planDate}T00:00:00.000Z`),
          routeTemplateId: plan.routeTemplateId,
        }));
      },
    },
    routeTemplate: {
      findMany: async () =>
        templateIds.map((id) => ({
          id,
          tenantId: "tenant-a",
          representativeUserId: "rep-a",
          name: id,
          items: [],
        })),
    },
    user: {
      findFirst: async () => ({ id: "rep-a" }),
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        routePlan: {
          create: async (args: {
            data: { planDate: Date; routeTemplateId: string };
          }) => {
            created.push(
              `${args.data.planDate.toISOString().slice(0, 10)}::${args.data.routeTemplateId}`,
            );
            return { id: `plan-${created.length}` };
          },
          // Shaped for toRoutePlanResponse, which the copy runs each written
          // plan through. Only `created` above is asserted on, so the values
          // themselves are placeholders.
          findUniqueOrThrow: async () => ({
            id: `plan-${created.length}`,
            representativeUserId: "rep-a",
            representative: {
              id: "rep-a",
              email: "rep-a@example.test",
              name: "Rep A",
            },
            planDate: new Date("2026-08-10T00:00:00.000Z"),
            status: "draft",
            publishedAt: null,
            createdByUserId: null,
            routeTemplateId: "template-a",
            routeTemplate: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            items: [],
          }),
        },
        routeItem: { createMany: async () => ({ count: 0 }) },
      }),
  };

  return {
    created,
    service: new RouteTemplatesService(
      prisma as never,
      noopAudit as never,
    ) as RouteTemplatesService,
  };
}

describe("copy route week", () => {
  it("moves every assignment onto the same weekday of the target week", async () => {
    const { service, created } = buildService({
      "2026-08-03": [
        { planDate: "2026-08-03", routeTemplateId: "template-a" },
        { planDate: "2026-08-06", routeTemplateId: "template-b" },
        { planDate: "2026-08-09", routeTemplateId: "template-a" },
      ],
      "2026-08-10": [],
    });

    const result = await service.copyRouteWeek(representativeContext as never, {
      fromWeekStart: "2026-08-03",
      toWeekStart: "2026-08-10",
    });

    assert.equal(result.createdCount, 3);
    assert.equal(result.skippedCount, 0);
    // Monday stays Monday, Sunday stays Sunday — a plain +7 on each date.
    assert.deepEqual(created, [
      "2026-08-10::template-a",
      "2026-08-13::template-b",
      "2026-08-16::template-a",
    ]);
  });

  it("carries several routes on one day, since a day may hold more than one", async () => {
    const { service, created } = buildService({
      "2026-08-03": [
        { planDate: "2026-08-03", routeTemplateId: "template-a" },
        { planDate: "2026-08-03", routeTemplateId: "template-b" },
      ],
      "2026-08-10": [],
    });

    const result = await service.copyRouteWeek(representativeContext as never, {
      fromWeekStart: "2026-08-03",
      toWeekStart: "2026-08-10",
    });

    assert.equal(result.createdCount, 2);
    assert.deepEqual(created, [
      "2026-08-10::template-a",
      "2026-08-10::template-b",
    ]);
  });

  it("skips a (day, template) pair the target week already holds, and keeps going", async () => {
    const { service, created } = buildService({
      "2026-08-03": [
        { planDate: "2026-08-03", routeTemplateId: "template-a" },
        { planDate: "2026-08-04", routeTemplateId: "template-b" },
      ],
      "2026-08-10": [{ planDate: "2026-08-10", routeTemplateId: "template-a" }],
    });

    const result = await service.copyRouteWeek(representativeContext as never, {
      fromWeekStart: "2026-08-03",
      toWeekStart: "2026-08-10",
    });

    assert.equal(result.createdCount, 1);
    assert.equal(result.skippedCount, 1);
    // The occupied Monday is left alone; Tuesday still lands.
    assert.deepEqual(created, ["2026-08-11::template-b"]);
  });

  it("copies backwards just as well, since both ends are named", async () => {
    const { service, created } = buildService({
      "2026-08-03": [{ planDate: "2026-08-06", routeTemplateId: "template-a" }],
      "2026-07-27": [],
    });

    const result = await service.copyRouteWeek(representativeContext as never, {
      fromWeekStart: "2026-08-03",
      toWeekStart: "2026-07-27",
    });

    assert.equal(result.createdCount, 1);
    assert.deepEqual(created, ["2026-07-30::template-a"]);
  });

  it("refuses a week start that is not a Monday rather than snapping it", async () => {
    const { service } = buildService({});

    // 2026-08-04 is a Tuesday. Accepting it would copy a seven-day window
    // straddling two weeks, which is not the week anyone is looking at.
    await assert.rejects(
      service.copyRouteWeek(representativeContext as never, {
        fromWeekStart: "2026-08-04",
        toWeekStart: "2026-08-10",
      }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "ROUTE_COPY_WEEK_INVALID",
    );
  });

  it("refuses a malformed or calendar-invalid week start", async () => {
    const { service } = buildService({});

    for (const fromWeekStart of ["2026-8-3", "2026-02-31", "not-a-date"]) {
      await assert.rejects(
        service.copyRouteWeek(representativeContext as never, {
          fromWeekStart,
          toWeekStart: "2026-08-10",
        }),
        (error: { response?: { code?: string } }) =>
          error.response?.code === "ROUTE_COPY_WEEK_INVALID",
        `${fromWeekStart} should be refused`,
      );
    }
  });

  it("refuses copying a week onto itself", async () => {
    const { service } = buildService({});

    await assert.rejects(
      service.copyRouteWeek(representativeContext as never, {
        fromWeekStart: "2026-08-03",
        toWeekStart: "2026-08-03",
      }),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "ROUTE_COPY_WEEK_SAME",
    );
  });
});
