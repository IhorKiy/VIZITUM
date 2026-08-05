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

function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Record to update not found", {
    code: "P2025",
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
      RouteTemplatesController.prototype.moveRouteTemplateItem,
      RouteTemplatesController.prototype.reorderRouteTemplateItems,
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

  it("requires only routes.read on the list and single-get endpoints", () => {
    const readHandlers = [
      RouteTemplatesController.prototype.listRouteTemplates,
      RouteTemplatesController.prototype.getRouteTemplate,
    ];

    for (const handler of readHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.ROUTES_READ],
        `${handler.name} must require routes.read`,
      );
    }
  });
});

describe("route template tenant isolation", () => {
  it("scopes listRouteTemplates reads by tenantId and returns a paginated response, matching /routes", async () => {
    const findManyQueries: Array<{
      where: { tenantId: string };
      skip: number;
      take: number;
    }> = [];
    const countQueries: Array<{ where: { tenantId: string } }> = [];
    const prisma = {
      routeTemplate: {
        findMany: async (query: {
          where: { tenantId: string };
          skip: number;
          take: number;
        }) => {
          findManyQueries.push(query);
          return [buildTemplate()];
        },
        count: async (query: { where: { tenantId: string } }) => {
          countQueries.push(query);
          return 1;
        },
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.listRouteTemplates(
      representativeContext as never,
      { page: 2, pageSize: 10 },
    );

    assert.equal(findManyQueries.length, 1);
    assert.equal(findManyQueries[0].where.tenantId, "tenant-a");
    // page 2 at pageSize 10 -> skip the first 10 rows.
    assert.equal(findManyQueries[0].skip, 10);
    assert.equal(findManyQueries[0].take, 10);
    assert.equal(countQueries.length, 1);
    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].id, "template-a");
    assert.deepEqual(
      { page: response.page, pageSize: response.pageSize, total: response.total, totalPages: response.totalPages },
      { page: 2, pageSize: 10, total: 1, totalPages: 1 },
    );
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

describe("route template list scope", () => {
  function buildListPrisma() {
    const whereCalls: unknown[] = [];

    return {
      whereCalls,
      prisma: {
        routeTemplate: {
          findMany: async (args: { where: unknown }) => {
            whereCalls.push(args.where);
            return [];
          },
          count: async (args: { where: unknown }) => {
            whereCalls.push(args.where);
            return 0;
          },
        },
      },
    };
  }

  it("returns every representative's templates when a team manager asks for no one in particular", async () => {
    // Same regression as GET /routes: this used to throw
    // AUTHENTICATION_CONTEXT_MISSING, contradicting api-reference.md's own
    // description of the query ("representativeUserId only honored for
    // routes.manage_team callers"). Both lists resolve their scope through
    // route-access.ts's shared helper so they cannot drift apart again.
    const { prisma, whereCalls } = buildListPrisma();
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.listRouteTemplates(managerContext as never, {});

    assert.equal(whereCalls.length, 2);
    for (const where of whereCalls) {
      assert.deepEqual(where, { tenantId: "tenant-a" });
      assert.equal(Object.hasOwn(where as object, "representativeUserId"), false);
    }
  });

  it("narrows to the requested representative when a team manager names one", async () => {
    const { prisma, whereCalls } = buildListPrisma();
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.listRouteTemplates(managerContext as never, {
      representativeUserId: "rep-b",
    });

    for (const where of whereCalls) {
      assert.deepEqual(where, {
        tenantId: "tenant-a",
        representativeUserId: "rep-b",
      });
    }
  });

  it("pins an own-scope representative to their own templates, ignoring a requested id", async () => {
    const { prisma, whereCalls } = buildListPrisma();
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.listRouteTemplates(representativeContext as never, {
      representativeUserId: "rep-b",
    });

    for (const where of whereCalls) {
      assert.deepEqual(where, {
        tenantId: "tenant-a",
        representativeUserId: "rep-a",
      });
    }
  });

  it("still refuses an own-scope read with no authenticated user to scope it to", async () => {
    const service = new RouteTemplatesService({} as never, noopAudit as never);

    await assert.rejects(
      service.listRouteTemplates(
        { ...representativeContext, userId: undefined } as never,
        {},
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "AUTHENTICATION_CONTEXT_MISSING");
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

  it("turns the ON DELETE SET NULL cascade colliding with an unrouted plan into a 409 instead of an unhandled 500", async () => {
    // route_plans_rep_date_no_template_key (partial unique, routeTemplateId
    // IS NULL) can collide with the cascade that nulls this template's
    // plans' routeTemplateId, if the same rep already holds a template-less
    // plan on one of those same dates — see deleteRouteTemplate.
    const prisma = {
      routeTemplate: {
        findFirst: async () => buildTemplate({ representativeUserId: "rep-b" }),
      },
      $transaction: async () => {
        throw p2002();
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRouteTemplate(managerContext as never, "template-a"),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_DELETE_CONFLICT");
        return true;
      },
    );
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

describe("get a single route template", () => {
  it("returns the caller's own template by id", async () => {
    const template = buildTemplate();
    const prisma = {
      routeTemplate: { findFirst: async () => template },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.getRouteTemplate(
      representativeContext as never,
      "template-a",
    );

    assert.equal(response.id, "template-a");
  });

  it("forbids fetching another representative's template", async () => {
    const prisma = {
      routeTemplate: {
        findFirst: async () => buildTemplate({ representativeUserId: "rep-b" }),
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.getRouteTemplate(representativeContext as never, "template-a"),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });
});

describe("route template item reorder", () => {
  it("swaps an item with its upward neighbor in one transaction", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
        buildTemplateItem({ id: "item-3", sequence: 3 }),
      ],
    });
    const updateCalls: Array<{ where: { id: string }; data: { sequence: number } }> = [];
    let transactionCallCount = 0;
    const prisma = {
      routeTemplate: {
        findFirst: async () => template,
        findUniqueOrThrow: async () => template,
      },
      $transaction: async (
        callback: (tx: {
          routeTemplateItem: {
            update: (args: {
              where: { id: string };
              data: { sequence: number };
            }) => Promise<unknown>;
          };
        }) => Promise<unknown>,
      ) => {
        transactionCallCount += 1;
        return callback({
          routeTemplateItem: {
            update: async (args) => {
              updateCalls.push(args);
              return {};
            },
          },
        });
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.moveRouteTemplateItem(
      representativeContext as never,
      "template-a",
      "item-2",
      { direction: "up" },
    );

    // All three sequence updates run inside a single transaction.
    assert.equal(transactionCallCount, 1);
    assert.deepEqual(
      updateCalls.map((call) => ({ id: call.where.id, sequence: call.data.sequence })),
      [
        { id: "item-2", sequence: 4 }, // bumped to a free temp slot first
        { id: "item-1", sequence: 2 }, // neighbor takes the moved item's old slot
        { id: "item-2", sequence: 1 }, // moved item settles into the neighbor's old slot
      ],
    );
  });

  it("is a no-op when the item is already at that edge of the list", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    let transactionCalled = false;
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      $transaction: async () => {
        transactionCalled = true;
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.moveRouteTemplateItem(
      representativeContext as never,
      "template-a",
      "item-1",
      { direction: "up" },
    );

    assert.equal(transactionCalled, false);
    assert.equal(response.id, "template-a");
  });

  it("rejects a direction other than up or down", async () => {
    const service = new RouteTemplatesService({} as never, noopAudit as never);

    await assert.rejects(
      service.moveRouteTemplateItem(
        representativeContext as never,
        "template-a",
        "item-1",
        { direction: "sideways" },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_MOVE_INVALID");
        return true;
      },
    );
  });

  it("404s when the item doesn't belong to the template", async () => {
    const template = buildTemplate({
      items: [buildTemplateItem({ id: "item-1", sequence: 1 })],
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.moveRouteTemplateItem(
        representativeContext as never,
        "template-a",
        "item-does-not-exist",
        { direction: "down" },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_NOT_FOUND");
        return true;
      },
    );
  });

  it("turns a concurrent move collision into a 409 instead of an unhandled 500", async () => {
    // Two overlapping moves on the same template both compute their
    // tempSequence from the same stale snapshot; the one that commits
    // second collides with the first and should 409, not 500.
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      $transaction: async () => {
        throw p2002();
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.moveRouteTemplateItem(
        representativeContext as never,
        "template-a",
        "item-2",
        { direction: "up" },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_SEQUENCE_TAKEN");
        return true;
      },
    );
  });
});

describe("route template item full reorder (drag-and-drop)", () => {
  it("bumps every item to a free slot before settling final sequences, in one transaction", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
        buildTemplateItem({ id: "item-3", sequence: 3 }),
      ],
    });
    const updateCalls: Array<{ where: { id: string }; data: { sequence: number } }> = [];
    let transactionCallCount = 0;
    const prisma = {
      routeTemplate: {
        findFirst: async () => template,
        findUniqueOrThrow: async () => template,
      },
      $transaction: async (
        callback: (tx: {
          routeTemplateItem: {
            update: (args: {
              where: { id: string };
              data: { sequence: number };
            }) => Promise<unknown>;
          };
        }) => Promise<unknown>,
      ) => {
        transactionCallCount += 1;
        return callback({
          routeTemplateItem: {
            update: async (args) => {
              updateCalls.push(args);
              return {};
            },
          },
        });
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await service.reorderRouteTemplateItems(
      representativeContext as never,
      "template-a",
      { itemIds: ["item-3", "item-1", "item-2"] },
    );

    assert.equal(transactionCallCount, 1);
    assert.deepEqual(
      updateCalls.map((call) => ({ id: call.where.id, sequence: call.data.sequence })),
      [
        // Phase 1: every item bumped to a temp slot past the current max (3),
        // in submitted order — none of these can collide with each other or
        // with a still-occupied 1..3 slot.
        { id: "item-3", sequence: 4 },
        { id: "item-1", sequence: 5 },
        { id: "item-2", sequence: 6 },
        // Phase 2: final 1..N assigned in the submitted (new) order.
        { id: "item-3", sequence: 1 },
        { id: "item-1", sequence: 2 },
        { id: "item-2", sequence: 3 },
      ],
    );
  });

  it("rejects a reorder that omits one of the template's stops", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = { routeTemplate: { findFirst: async () => template } };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteTemplateItems(
        representativeContext as never,
        "template-a",
        { itemIds: ["item-1"] },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("rejects a reorder with a duplicated id", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = { routeTemplate: { findFirst: async () => template } };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteTemplateItems(
        representativeContext as never,
        "template-a",
        { itemIds: ["item-1", "item-1"] },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("rejects a reorder that references a stop from another template", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = { routeTemplate: { findFirst: async () => template } };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteTemplateItems(
        representativeContext as never,
        "template-a",
        { itemIds: ["item-1", "item-from-another-template"] },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("turns a concurrent reorder collision into a 409 instead of an unhandled 500", async () => {
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      $transaction: async () => {
        throw p2002();
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteTemplateItems(
        representativeContext as never,
        "template-a",
        { itemIds: ["item-2", "item-1"] },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_SEQUENCE_TAKEN");
        return true;
      },
    );
  });

  it("turns a stop deleted mid-transaction into a 400 instead of an unhandled 500", async () => {
    // template.items is a pre-transaction snapshot: another session deleting
    // one of these stops between the validation and the transaction itself
    // surfaces here as the update on its now-gone id 404ing at the DB level.
    const template = buildTemplate({
      items: [
        buildTemplateItem({ id: "item-1", sequence: 1 }),
        buildTemplateItem({ id: "item-2", sequence: 2 }),
      ],
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      $transaction: async () => {
        throw p2025();
      },
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteTemplateItems(
        representativeContext as never,
        "template-a",
        { itemIds: ["item-2", "item-1"] },
      ),
      (error: unknown) => {
        assert.equal(errorCode(error), "ROUTE_TEMPLATE_ITEM_REORDER_INVALID");
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

  it("rejects assigning the same template twice to the same date with a 409", async () => {
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

  it("allows assigning a different template to a date that already has a plan", async () => {
    // route_plans_rep_date_template_key is partial (WHERE routeTemplateId IS
    // NOT NULL) and scoped to (tenantId, representativeUserId, planDate,
    // routeTemplateId), so a second, different template for the same day
    // just creates another row — no P2002, no special-casing needed here.
    const template = buildTemplate({ id: "template-b", name: "Left Bank" });
    const createdPlan = buildMaterializedPlan({
      id: "plan-second",
      routeTemplateId: "template-b",
      routeTemplate: { id: "template-b", name: "Left Bank" },
    });
    const prisma = {
      routeTemplate: { findFirst: async () => template },
      user: { findFirst: async () => activeRepUser },
      $transaction: async (
        callback: (tx: {
          routePlan: {
            create: (args: unknown) => Promise<{ id: string }>;
            findUniqueOrThrow: () => Promise<typeof createdPlan>;
          };
          routeItem: { createMany: (args: unknown) => Promise<unknown> };
        }) => Promise<unknown>,
      ) =>
        callback({
          routePlan: {
            create: async () => ({ id: "plan-second" }),
            findUniqueOrThrow: async () => createdPlan,
          },
          routeItem: { createMany: async () => ({ count: 0 }) },
        }),
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const response = await service.assignRouteTemplate(
      representativeContext as never,
      "template-b",
      { planDate: "2026-07-20" },
    );

    assert.equal(response.id, "plan-second");
    assert.equal(response.routeTemplateId, "template-b");
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
      // Same template as the Aug 10 source day -> genuinely a duplicate,
      // still skipped. (A different template on Sep 10 would NOT block this
      // copy — see the "different template" test below.)
      { planDate: new Date("2026-09-10T00:00:00.000Z"), routeTemplateId: "template-a" },
    ];
    const template = buildTemplate({ items: [buildTemplateItem()] });
    const createdPlanDates: string[] = [];
    const findManyWheres: Array<Record<string, unknown>> = [];
    let templateFindManyCallCount = 0;
    let routePlanFindManyCallCount = 0;
    const prisma = {
      user: { findFirst: async () => activeRepUser },
      routePlan: {
        findMany: async (query: { where: Record<string, unknown> }) => {
          findManyWheres.push(query.where);
          routePlanFindManyCallCount += 1;
          // Promise.all evaluates the source-days and occupied-days queries
          // in registration order, so the first call is always the source
          // query and the second the occupied one — both now filter on
          // routeTemplateId: { not: null }, so that can no longer be used to
          // tell them apart the way a routeTemplateId-truthiness check did.
          return routePlanFindManyCallCount === 1
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

  it("copies a template onto a target day that already has a different template assigned", async () => {
    const sourcePlans = [
      {
        planDate: new Date("2026-08-05T00:00:00.000Z"),
        routeTemplateId: "template-a",
      },
    ];
    const existingPlansInTargetMonth = [
      // Different template than the one being copied -> must NOT block it.
      { planDate: new Date("2026-09-05T00:00:00.000Z"), routeTemplateId: "template-b" },
    ];
    const template = buildTemplate({ items: [] });
    const createdPlanDates: string[] = [];
    let routePlanFindManyCallCount = 0;
    const prisma = {
      user: { findFirst: async () => activeRepUser },
      routePlan: {
        findMany: async () => {
          routePlanFindManyCallCount += 1;
          return routePlanFindManyCallCount === 1
            ? sourcePlans
            : existingPlansInTargetMonth;
        },
      },
      routeTemplate: {
        findMany: async () => [template],
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
              return { id: "plan-x" };
            },
            findUniqueOrThrow: async () => buildMaterializedPlan(),
          },
          routeItem: { createMany: async () => ({ count: 0 }) },
        }),
    };
    const service = new RouteTemplatesService(prisma as never, noopAudit as never);

    const result = await service.copyRoutePlans(
      representativeContext as never,
      { month: "2026-09" },
    );

    assert.deepEqual(result, { createdCount: 1, skippedCount: 0 });
    assert.deepEqual(createdPlanDates, ["2026-09-05"]);
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
    let routePlanFindManyCallCount = 0;
    const prisma = {
      user: { findFirst: async () => activeRepUser },
      routePlan: {
        findMany: async () => {
          routePlanFindManyCallCount += 1;
          return routePlanFindManyCallCount === 1 ? sourcePlans : [];
        },
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
