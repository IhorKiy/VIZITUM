import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RouteTemplatesController } from "../src/modules/routes/route-templates.controller";
import { RouteTemplatesService } from "../src/modules/routes/route-templates.service";

// Most tests here never reach an audited write (ownership/validation checks
// throw first), so this no-op stands in for AuditService wherever the call
// itself isn't under test.
const noopAudit = { recordEvent: async () => {} };

// assertFieldRepresentative's default answer: an active field rep, so tests
// that aren't specifically about that check don't have to think about it.
const activeRepUser = { id: "rep-a" };

const manageAnyPermissions = [
  PERMISSIONS.ROUTES_MANAGE_TEAM,
  PERMISSIONS.ROUTES_MANAGE_OWN,
];

const representativeContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_OWN],
};

const managerContext = {
  requestId: "request-b",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_TEAM],
};

const otherTenantContext = {
  requestId: "request-c",
  tenantId: "tenant-b",
  tenantSlug: "tenant-b",
  userId: "rep-b",
  roleCodes: ["field_representative"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_OWN],
};

const templateTimestamp = new Date("2026-07-01T00:00:00.000Z");

function buildTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-a",
    tenantId: "tenant-a",
    representativeUserId: "rep-a",
    name: "Стрий",
    createdAt: templateTimestamp,
    updatedAt: templateTimestamp,
    items: [] as unknown[],
    ...overrides,
  };
}

function buildTemplateItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    tenantId: "tenant-a",
    routeTemplateId: "template-a",
    locationId: "loc-1",
    sequence: 1,
    location: {
      id: "loc-1",
      name: "Depot A",
      addressLine: "1 Main St",
      city: "Kyiv",
    },
    createdAt: templateTimestamp,
    updatedAt: templateTimestamp,
    ...overrides,
  };
}

function buildMaterializedPlan(overrides: Record<string, unknown> = {}) {
  const planDate = new Date("2026-09-05T00:00:00.000Z");

  return {
    id: "plan-new",
    representativeUserId: "rep-a",
    representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
    planDate,
    status: "draft",
    publishedAt: null,
    createdByUserId: null,
    routeTemplateId: "template-a",
    routeTemplate: { id: "template-a", name: "Стрий" },
    createdAt: planDate,
    updatedAt: planDate,
    items: [],
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

function errorCode(error: unknown): unknown {
  return (error as { getResponse?: () => { code?: string } }).getResponse?.()
    .code;
}

describe("route templates permissions", () => {
  it("requires a manage permission on every mutation endpoint", () => {
    const mutationHandlers = [
      RouteTemplatesController.prototype.createRouteTemplate,
      RouteTemplatesController.prototype.copyRoutePlans,
      RouteTemplatesController.prototype.updateRouteTemplate,
      RouteTemplatesController.prototype.deleteRouteTemplate,
      RouteTemplatesController.prototype.createRouteTemplateItem,
      RouteTemplatesController.prototype.updateRouteTemplateItem,
      RouteTemplatesController.prototype.deleteRouteTemplateItem,
      RouteTemplatesController.prototype.assignRouteTemplate,
    ];

    for (const handler of mutationHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
        manageAnyPermissions,
        `${handler.name} must require routes.manage_team or routes.manage_own`,
      );
    }
  });

  it("requires only routes.read on the list endpoint", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_METADATA,
        RouteTemplatesController.prototype.listRouteTemplates,
      ),
      [PERMISSIONS.ROUTES_READ],
    );
  });
});

describe("route template tenant isolation", () => {
  it("scopes listRouteTemplates reads by tenantId", async () => {
    const queries: Array<{ where: { tenantId: string } }> = [];
    const prisma = {
      routeTemplate: {
        findMany: async (query: { where: { tenantId: string } }) => {
          queries.push(query);
          return [];
        },
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.listRouteTemplates(representativeContext as never, {});

    assert.equal(queries.length, 1);
    assert.equal(queries[0].where.tenantId, "tenant-a");
  });

  it("404s instead of leaking a template that belongs to another tenant", async () => {
    const prisma = {
      routeTemplate: {
        // A real Prisma findFirst scoped by tenantId returns null for a
        // cross-tenant id; the mock mirrors that instead of asserting on it,
        // so this test pins the service's NOT_FOUND handling, not Prisma's.
        findFirst: async () => null,
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.updateRouteTemplate(otherTenantContext as never, "template-a", {
        name: "Hijacked",
      }),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_NOT_FOUND");
        return true;
      },
    );
  });
});

describe("route template ownership scope", () => {
  it("forbids a representative from creating a template for someone else", async () => {
    const service = new RouteTemplatesService({} as never, noopAudit as never);

    await assert.rejects(
      service.createRouteTemplate(representativeContext as never, {
        representativeUserId: "rep-b",
        name: "Стрий",
      }),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("allows a representative to create their own template", async () => {
    const created = buildTemplate();
    const prisma = {
      user: {
        findFirst: async () => activeRepUser,
      },
      routeTemplate: {
        create: async () => created,
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.createRouteTemplate(
      representativeContext as never,
      { representativeUserId: "rep-a", name: "Стрий" },
    );

    assert.equal(response.id, "template-a");
    assert.equal(response.representativeUserId, "rep-a");
  });

  it("rejects creating a template for a user who isn't an active field representative", async () => {
    const prisma = {
      user: {
        findFirst: async () => null,
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.createRouteTemplate(representativeContext as never, {
        representativeUserId: "rep-a",
        name: "Стрий",
      }),
      (error: unknown) => {
        assert.equal(errorCode(error), "REPRESENTATIVE_INVALID");
        return true;
      },
    );
  });

  it("forbids a representative from deleting another representative's template", async () => {
    const prisma = {
      routeTemplate: {
        findFirst: async () => buildTemplate({ representativeUserId: "rep-b" }),
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRouteTemplate(representativeContext as never, "template-a"),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("deletes a template and records an audit event through the same transaction", async () => {
    const auditEvents: unknown[] = [];
    const auditClients: unknown[] = [];
    const prisma = {
      routeTemplate: {
        findFirst: async () => buildTemplate({ representativeUserId: "rep-b" }),
        delete: async () => buildTemplate({ representativeUserId: "rep-b" }),
      },
      // Delete + audit run through one transaction; hand this same object
      // back as the transaction client so the tx-routing is observable.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
    };
    const audit = {
      recordEvent: async (
        context: { userId?: string },
        input: unknown,
        client?: unknown,
      ): Promise<void> => {
        auditEvents.push({ actorUserId: context.userId, input });
        auditClients.push(client);
      },
    };
    const service = new RouteTemplatesService(prisma as never, audit as never);

    const response = await service.deleteRouteTemplate(
      managerContext as never,
      "template-a",
    );

    assert.deepEqual(response, { deleted: true });
    assert.deepEqual(auditEvents, [
      {
        actorUserId: "manager-a",
        input: {
          entityType: "route_template",
          entityId: "template-a",
          eventType: "route_template.deleted",
        },
      },
    ]);
    // Audited through the same transaction as the delete, so neither can
    // exist without the other.
    assert.deepEqual(auditClients, [prisma]);
  });
});

describe("route template item sequence conflicts", () => {
  it("turns a concurrent create collision into a 409 instead of an unhandled 500", async () => {
    const template = buildTemplate();
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      location: { findFirst: async () => ({ id: "loc-1" }) },
      routeTemplateItem: {
        create: async () => {
          throw p2002();
        },
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.createRouteTemplateItem(representativeContext as never, "template-a", {
        locationId: "loc-1",
        sequence: 1,
      }),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_SEQUENCE_TAKEN");
        return true;
      },
    );
  });

  it("turns a concurrent reorder collision into a 409 instead of an unhandled 500", async () => {
    const template = buildTemplate({
      items: [buildTemplateItem({ id: "item-1", sequence: 1 })],
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      routeTemplateItem: {
        findFirst: async () => buildTemplateItem({ id: "item-1", sequence: 1 }),
        update: async () => {
          throw p2002();
        },
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.updateRouteTemplateItem(
        representativeContext as never,
        "template-a",
        "item-1",
        { sequence: 2 },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_SEQUENCE_TAKEN");
        return true;
      },
    );
  });
});

describe("route template assignment", () => {
  it("materializes a plan with items copied from the template in order", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", locationId: "loc-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", locationId: "loc-2", sequence: 2 }),
      ],
    });
    const createManyCalls: Array<{ data: unknown[] }> = [];
    const planDate = new Date("2026-07-20T00:00:00.000Z");
    const materializedPlan = buildMaterializedPlan({ planDate });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      user: { findFirst: async () => activeRepUser },
      $transaction: async (
        callback: (tx: {
          routePlan: {
            create: (args: unknown) => Promise<{ id: string }>;
            findUniqueOrThrow: () => Promise<typeof materializedPlan>;
          };
          routeItem: { createMany: (args: unknown) => Promise<unknown> };
        }) => Promise<unknown>,
      ) =>
        callback({
          routePlan: {
            create: async () => ({ id: "plan-new" }),
            findUniqueOrThrow: async () => materializedPlan,
          },
          routeItem: {
            createMany: async (args: { data: unknown[] }) => {
              createManyCalls.push(args);
              return { count: args.data.length };
            },
          },
        }),
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.assignRouteTemplate(
      representativeContext as never,
      "template-a",
      { planDate: "2026-07-20" },
    );

    assert.equal(response.id, "plan-new");
    assert.equal(response.routeTemplateId, "template-a");
    assert.equal(createManyCalls.length, 1);
    assert.deepEqual(createManyCalls[0].data, [
      {
        tenantId: "tenant-a",
        routePlanId: "plan-new",
        locationId: "loc-1",
        sequence: 1,
      },
      {
        tenantId: "tenant-a",
        routePlanId: "plan-new",
        locationId: "loc-2",
        sequence: 2,
      },
    ]);
  });

  it("rejects assigning to a date that already has a plan with a 409", async () => {
    const template = buildTemplate();
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      user: { findFirst: async () => activeRepUser },
      $transaction: async () => {
        throw p2002();
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.assignRouteTemplate(
        representativeContext as never,
        "template-a",
        {
          planDate: "2026-07-20",
        },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_PLAN_ALREADY_EXISTS");
        return true;
      },
    );
  });

  it("rejects an assign call with a missing or malformed plan date", async () => {
    const template = buildTemplate();
    const prisma = {
      routeTemplate: { findFirst: async () => template },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.assignRouteTemplate(
        representativeContext as never,
        "template-a",
        {
          planDate: "not-a-date",
        },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ASSIGN_INVALID");
        return true;
      },
    );
  });

  it("rejects assigning a template whose representative is no longer an active field representative", async () => {
    const template = buildTemplate();
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      // Deactivated (or deleted/re-roled) since the template was created.
      user: { findFirst: async () => null },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.assignRouteTemplate(
        representativeContext as never,
        "template-a",
        { planDate: "2026-07-20" },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "REPRESENTATIVE_INVALID");
        return true;
      },
    );
  });
});

describe("route plan copy-month", () => {
  it("skips a source day with no template, a day already planned, and a day that doesn't exist in the target month, while creating the rest — with one flat query each for source days, occupied days and templates", async () => {
    // August 2026 -> September 2026 (30 days). Source plans: the 5th
    // (templated, free slot -> created), the 10th (templated, but September
    // 10th is already taken -> skipped), the 31st (templated, but September
    // has no 31st -> skipped). A plan with no template attached is never
    // returned by the real query (routeTemplateId: { not: null }), so it's
    // not part of this fixture — see the where-clause assertion below.
    const sourcePlans = [
      {
        planDate: new Date("2026-08-05T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
      {
        planDate: new Date("2026-08-10T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
      {
        planDate: new Date("2026-08-31T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
    ];
    const existingPlansInTargetMonth = [
      { planDate: new Date("2026-09-10T00:00:00.000Z") },
    ];
    const template = buildTemplate({ items: [buildTemplateItem()] });
    const createdPlanDates: string[] = [];
    const findManyWheres: Array<Record<string, unknown>> = [];
    let templateFindManyCallCount = 0;
    const prisma = {
      user: { findFirst: async () => activeRepUser },
      routePlan: {
        findMany: async (query: { where: Record<string, unknown> }) => {
          findManyWheres.push(query.where);
          // The source-days query is the only one filtered on
          // routeTemplateId; the occupied-days query only scopes by date.
          return query.where.routeTemplateId
            ? sourcePlans
            : existingPlansInTargetMonth;
        },
      },
      routeTemplate: {
        findMany: async () => {
          templateFindManyCallCount += 1;
          return [template];
        },
      },
      $transaction: async (
        callback: (tx: {
          routePlan: {
            create: (args: {
              data: { planDate: Date };
            }) => Promise<{ id: string }>;
            findUniqueOrThrow: () => Promise<Record<string, unknown>>;
          };
          routeItem: { createMany: () => Promise<unknown> };
        }) => Promise<unknown>,
      ) =>
        callback({
          routePlan: {
            create: async (args: { data: { planDate: Date } }) => {
              createdPlanDates.push(
                args.data.planDate.toISOString().slice(0, 10),
              );
              return { id: `plan-${createdPlanDates.length}` };
            },
            findUniqueOrThrow: async () =>
              buildMaterializedPlan({
                id: "plan-x",
                planDate: new Date("2026-09-05T00:00:00.000Z"),
              }),
          },
          routeItem: { createMany: async () => ({ count: 1 }) },
        }),
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const result = await service.copyRoutePlans(
      representativeContext as never,
      {
        month: "2026-09",
      },
    );

    assert.deepEqual(result, { createdCount: 1, skippedCount: 2 });
    assert.deepEqual(createdPlanDates, ["2026-09-05"]);
    // One findMany for source days, one for occupied days — not one call
    // per day in the month.
    assert.equal(findManyWheres.length, 2);
    assert.deepEqual(findManyWheres[0].routeTemplateId, { not: null });
    // Three source days all reference the same template: fetched once, not
    // re-read on every iteration.
    assert.equal(templateFindManyCallCount, 1);
  });

  it("counts a concurrent assign race as skipped instead of aborting the rest of the batch", async () => {
    const sourcePlans = [
      {
        planDate: new Date("2026-08-05T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
      {
        planDate: new Date("2026-08-06T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
    ];
    const template = buildTemplate({ items: [] });
    let transactionCallCount = 0;
    const prisma = {
      user: { findFirst: async () => activeRepUser },
      routePlan: {
        findMany: async (query: { where: Record<string, unknown> }) =>
          query.where.routeTemplateId ? sourcePlans : [],
      },
      routeTemplate: {
        findMany: async () => [template],
      },
      $transaction: async (
        callback: (tx: {
          routePlan: {
            create: () => Promise<{ id: string }>;
            findUniqueOrThrow: () => Promise<Record<string, unknown>>;
          };
          routeItem: { createMany: () => Promise<unknown> };
        }) => Promise<unknown>,
      ) => {
        transactionCallCount += 1;

        // Simulate a second tab (or a manager) winning the race for the
        // second day between this batch's snapshot and its own create.
        if (transactionCallCount === 2) {
          throw p2002();
        }

        return callback({
          routePlan: {
            create: async () => ({ id: "plan-x" }),
            findUniqueOrThrow: async () => buildMaterializedPlan(),
          },
          routeItem: { createMany: async () => ({ count: 0 }) },
        });
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const result = await service.copyRoutePlans(
      representativeContext as never,
      { month: "2026-09" },
    );

    assert.deepEqual(result, { createdCount: 1, skippedCount: 1 });
  });

  it("rejects a malformed month", async () => {
    const service = new RouteTemplatesService({} as never, noopAudit as never);

    await assert.rejects(
      service.copyRoutePlans(representativeContext as never, {
        month: "2026-13",
      }),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_COPY_MONTH_INVALID");
        return true;
      },
    );
  });
});
