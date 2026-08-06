import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RouteTemplatesService } from "../src/modules/routes/route-templates.service";

// `POST /routes/templates/:templateId/assign-many` is what the month
// planner's multi-select posts: one template onto every ticked date in a
// single call rather than one request per date. Its contract is the same as
// the two copy routes — counts back, an already-taken (date, template) pair
// counted as skipped rather than raised, so a batch of a dozen dates is not
// abandoned because one of them was already planned.

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

/** `takenDates` stand in for days the representative already holds this template on. */
function buildService(takenDates: string[] = []) {
  const created: string[] = [];
  const taken = new Set(takenDates);

  const prisma = {
    routeTemplate: {
      findFirst: async () => ({
        id: "template-a",
        tenantId: "tenant-a",
        representativeUserId: "rep-a",
        name: "Template A",
        items: [],
      }),
    },
    user: { findFirst: async () => ({ id: "rep-a" }) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        routePlan: {
          create: async (args: { data: { planDate: Date } }) => {
            const date = args.data.planDate.toISOString().slice(0, 10);

            if (taken.has(date)) {
              // What Postgres raises on route_plans_rep_date_template_key.
              // A real Prisma error class, not a look-alike:
              // isUniqueConstraintViolation checks `instanceof`, so a plain
              // object with code P2002 would sail past it as an unhandled
              // error and the skip path would never be exercised.
              throw new Prisma.PrismaClientKnownRequestError(
                "Unique constraint failed",
                { code: "P2002", clientVersion: "test" },
              );
            }

            created.push(date);
            return { id: `plan-${created.length}` };
          },
          findUniqueOrThrow: async () => ({
            id: `plan-${created.length}`,
            representativeUserId: "rep-a",
            representative: {
              id: "rep-a",
              email: "rep-a@example.test",
              name: "Rep A",
            },
            planDate: timestamp,
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

describe("assign one route template to many dates", () => {
  it("writes a plan for every date in the selection", async () => {
    const { service, created } = buildService();

    const result = await service.assignRouteTemplateToDates(
      representativeContext as never,
      "template-a",
      { planDates: ["2026-08-10", "2026-08-12", "2026-08-14"] },
    );

    assert.equal(result.createdCount, 3);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(created, ["2026-08-10", "2026-08-12", "2026-08-14"]);
  });

  it("runs the batch in calendar order whatever order the selection arrived in", async () => {
    const { service, created } = buildService();

    await service.assignRouteTemplateToDates(
      representativeContext as never,
      "template-a",
      { planDates: ["2026-08-14", "2026-08-10", "2026-08-12"] },
    );

    assert.deepEqual(created, ["2026-08-10", "2026-08-12", "2026-08-14"]);
  });

  it("deduplicates before writing, so a repeated date is not a self-inflicted skip", async () => {
    const { service, created } = buildService();

    const result = await service.assignRouteTemplateToDates(
      representativeContext as never,
      "template-a",
      { planDates: ["2026-08-10", "2026-08-10", "2026-08-11"] },
    );

    assert.equal(result.createdCount, 2);
    assert.equal(result.skippedCount, 0);
    assert.deepEqual(created, ["2026-08-10", "2026-08-11"]);
  });

  it("counts an already-planned date as skipped and finishes the rest", async () => {
    const { service, created } = buildService(["2026-08-11"]);

    const result = await service.assignRouteTemplateToDates(
      representativeContext as never,
      "template-a",
      { planDates: ["2026-08-10", "2026-08-11", "2026-08-12"] },
    );

    assert.equal(result.createdCount, 2);
    assert.equal(result.skippedCount, 1);
    assert.deepEqual(created, ["2026-08-10", "2026-08-12"]);
  });

  it("refuses an empty or missing selection", async () => {
    const { service } = buildService();

    for (const planDates of [[], undefined, null, "2026-08-10"]) {
      await assert.rejects(
        service.assignRouteTemplateToDates(
          representativeContext as never,
          "template-a",
          { planDates },
        ),
        (error: { response?: { code?: string } }) =>
          error.response?.code === "ROUTE_TEMPLATE_ASSIGN_INVALID",
      );
    }
  });

  it("refuses a malformed or calendar-invalid date without writing the rest", async () => {
    const { service, created } = buildService();

    await assert.rejects(
      service.assignRouteTemplateToDates(
        representativeContext as never,
        "template-a",
        { planDates: ["2026-08-10", "2026-02-31"] },
      ),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "ROUTE_TEMPLATE_ASSIGN_INVALID",
    );
    // Every date is parsed before anything is written, so a bad one in the
    // batch cannot leave half the selection assigned.
    assert.deepEqual(created, []);
  });

  it("refuses a batch past the cap rather than accepting an unbounded write", async () => {
    const { service } = buildService();
    const tooMany = Array.from({ length: 401 }, (_, index) =>
      new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    );

    await assert.rejects(
      service.assignRouteTemplateToDates(
        representativeContext as never,
        "template-a",
        { planDates: tooMany },
      ),
      (error: { response?: { code?: string } }) =>
        error.response?.code === "ROUTE_TEMPLATE_ASSIGN_INVALID",
    );
  });
});
