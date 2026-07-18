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
    const service = new RouteTemplatesService(prisma as never);

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
    const service = new RouteTemplatesService(prisma as never);

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
    const service = new RouteTemplatesService({} as never);

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
        findFirst: async () => ({ id: "rep-a" }),
      },
      routeTemplate: {
        create: async () => created,
      },
    };
    const service = new RouteTemplatesService(prisma as never);

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
    const service = new RouteTemplatesService(prisma as never);

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
    const service = new RouteTemplatesService(prisma as never);

    await assert.rejects(
      service.deleteRouteTemplate(representativeContext as never, "template-a"),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("allows a team manager to manage any representative's template", async () => {
    const prisma = {
      routeTemplate: {
        findFirst: async () => buildTemplate({ representativeUserId: "rep-b" }),
        delete: async () => buildTemplate({ representativeUserId: "rep-b" }),
      },
    };
    const service = new RouteTemplatesService(prisma as never);

    const response = await service.deleteRouteTemplate(
      managerContext as never,
      "template-a",
    );

    assert.deepEqual(response, { deleted: true });
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
    const materializedPlan = {
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
    };
    const prisma = {
      routeTemplate: { findFirst: async () => template },
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
    const service = new RouteTemplatesService(prisma as never);

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
      $transaction: async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          "Unique constraint failed",
          { code: "P2002", clientVersion: "test" },
        );
      },
    };
    const service = new RouteTemplatesService(prisma as never);

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
    const service = new RouteTemplatesService(prisma as never);

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
});

describe("route plan copy-month", () => {
  it("skips a source day that has no template, a day already planned, and a day that doesn't exist in the target month, while creating the rest", async () => {
    // August 2026 -> September 2026 (30 days). Source plans: the 5th
    // (templated, free slot), the 10th (templated, but September 10th is
    // already taken), the 15th (no template attached), and the 31st
    // (templated, but September has no 31st).
    const sourcePlans = [
      {
        planDate: new Date("2026-08-05T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
      {
        planDate: new Date("2026-08-10T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
      { planDate: new Date("2026-08-15T00:00:00.000Z"), routeTemplateId: null },
      {
        planDate: new Date("2026-08-31T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
    ];
    const template = buildTemplate({
      items: [buildTemplateItem()],
    });
    const createdPlanDates: string[] = [];
    const prisma = {
      routePlan: {
        findMany: async () => sourcePlans,
        findUnique: async (args: {
          where: { tenantId_representativeUserId_planDate: { planDate: Date } };
        }) => {
          const day = args.where.tenantId_representativeUserId_planDate.planDate
            .toISOString()
            .slice(0, 10);
          return day === "2026-09-10" ? { id: "existing-plan" } : null;
        },
      },
      routeTemplate: {
        findFirst: async () => template,
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
            findUniqueOrThrow: async () => ({
              id: "plan-x",
              representativeUserId: "rep-a",
              representative: {
                id: "rep-a",
                email: "rep@example.com",
                name: "Rep A",
              },
              planDate: new Date("2026-09-05T00:00:00.000Z"),
              status: "draft",
              publishedAt: null,
              createdByUserId: null,
              routeTemplateId: "template-a",
              routeTemplate: { id: "template-a", name: "Стрий" },
              createdAt: new Date("2026-09-05T00:00:00.000Z"),
              updatedAt: new Date("2026-09-05T00:00:00.000Z"),
              items: [],
            }),
          },
          routeItem: { createMany: async () => ({ count: 1 }) },
        }),
    };
    const service = new RouteTemplatesService(prisma as never);

    const result = await service.copyRoutePlans(
      representativeContext as never,
      {
        month: "2026-09",
      },
    );

    assert.deepEqual(result, { createdCount: 1, skippedCount: 3 });
    assert.deepEqual(createdPlanDates, ["2026-09-05"]);
  });

  it("rejects a malformed month", async () => {
    const service = new RouteTemplatesService({} as never);

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
