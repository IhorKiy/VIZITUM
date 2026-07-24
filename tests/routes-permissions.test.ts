import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { RoutesController } from "../src/modules/routes/routes.controller";
import { RoutesService } from "../src/modules/routes/routes.service";

// Most tests here never reach an audited write (ownership/status checks
// throw first), so this no-op stands in for AuditService wherever the call
// itself isn't under test.
const noopAudit = { recordEvent: async () => {} };

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
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: [PERMISSIONS.ROUTES_READ, PERMISSIONS.ROUTES_MANAGE_TEAM],
};

const planDate = new Date("2026-07-03T00:00:00.000Z");

function buildFullPlan(representativeUserId: string) {
  return {
    id: "plan-a",
    representativeUserId,
    representative: {
      id: representativeUserId,
      email: "rep@example.com",
      name: "Rep A",
    },
    planDate,
    status: "draft",
    publishedAt: null,
    createdByUserId: "manager-a",
    createdAt: planDate,
    updatedAt: planDate,
    items: [],
  };
}

function buildRouteItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    tenantId: "tenant-a",
    routePlanId: "plan-a",
    locationId: "loc-1",
    sequence: 1,
    status: "planned",
    plannedStartTime: null,
    plannedEndTime: null,
    skipReason: null,
    createdAt: planDate,
    updatedAt: planDate,
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("routes permissions", () => {
  it("requires a manage permission on every mutation endpoint", () => {
    const mutationHandlers = [
      RoutesController.prototype.createRoutePlan,
      RoutesController.prototype.updateRoutePlan,
      RoutesController.prototype.deleteRoutePlan,
      RoutesController.prototype.createRouteItem,
      RoutesController.prototype.updateRouteItem,
      RoutesController.prototype.deleteRouteItem,
      RoutesController.prototype.reorderRouteItems,
    ];

    for (const handler of mutationHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
        manageAnyPermissions,
        `${handler.name} must require routes.manage_team or routes.manage_own`,
      );
    }
  });

  it("requires only routes.read on read endpoints", () => {
    const readHandlers = [
      RoutesController.prototype.getTodayRoutes,
      RoutesController.prototype.listRoutes,
    ];

    for (const handler of readHandlers) {
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler),
        [PERMISSIONS.ROUTES_READ],
        `${handler.name} must require routes.read`,
      );
    }
  });

  it("forbids a representative from updating another representative's plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-b",
        }),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.updateRoutePlan(representativeContext as never, "plan-a", {
        status: "published",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("forbids a representative from creating a plan for someone else", async () => {
    const service = new RoutesService({} as never, noopAudit as never);

    await assert.rejects(
      service.createRoutePlan(representativeContext as never, {
        representativeUserId: "rep-b",
        planDate: "2026-07-03",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("creates a new template-less plan when the representative has none for that date yet", async () => {
    const createdPlan = buildFullPlan("rep-a");
    const prisma = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routePlan: {
        findFirst: async () => null,
        create: async () => createdPlan,
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    const response = await service.createRoutePlan(
      representativeContext as never,
      { representativeUserId: "rep-a", planDate: "2026-07-03" },
    );

    assert.equal(response.id, "plan-a");
  });

  it("returns the existing template-less plan directly instead of creating a duplicate", async () => {
    const existingPlan = buildFullPlan("rep-a");
    const prisma = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routePlan: {
        findFirst: async () => existingPlan,
        create: async () => {
          throw new Error(
            "create should not be called when a plan already exists",
          );
        },
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    const response = await service.createRoutePlan(
      representativeContext as never,
      { representativeUserId: "rep-a", planDate: "2026-07-03" },
    );

    assert.equal(response.id, "plan-a");
  });

  it("returns the winner's plan instead of a 409 when a concurrent create races the same (rep, date) pair", async () => {
    // The upsert this get-or-create replaced was atomic and returned the
    // existing row on a race instead of erroring; the P2002 branch re-fetches
    // for the same reason — see routes.service.ts's createRoutePlan.
    const racedPlan = buildFullPlan("rep-a");
    let findFirstCallCount = 0;
    const prisma = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routePlan: {
        findFirst: async () => {
          findFirstCallCount += 1;
          // 1st call: the initial get-or-create check, finds nothing yet.
          // 2nd call: after the raced create's P2002, finds the winner's row.
          return findFirstCallCount === 1 ? null : racedPlan;
        },
        create: async () => {
          throw p2002();
        },
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    const response = await service.createRoutePlan(
      representativeContext as never,
      { representativeUserId: "rep-a", planDate: "2026-07-03" },
    );

    assert.equal(response.id, "plan-a");
    assert.equal(findFirstCallCount, 2);
  });

  it("still 409s if the P2002 conflict can't be resolved on re-fetch", async () => {
    const prisma = {
      user: { findFirst: async () => ({ id: "rep-a" }) },
      routePlan: {
        findFirst: async () => null,
        create: async () => {
          throw p2002();
        },
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.createRoutePlan(representativeContext as never, {
        representativeUserId: "rep-a",
        planDate: "2026-07-03",
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_PLAN_ALREADY_EXISTS");
        return true;
      },
    );
  });

  it("allows a representative to update their own plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
        update: async () => buildFullPlan("rep-a"),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    const response = await service.updateRoutePlan(
      representativeContext as never,
      "plan-a",
      { status: "published" },
    );

    assert.equal(response.id, "plan-a");
    assert.equal(response.representativeUserId, "rep-a");
  });

  it("allows a team manager to update any representative's plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-b",
        }),
        update: async () => buildFullPlan("rep-b"),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    const response = await service.updateRoutePlan(
      managerContext as never,
      "plan-a",
      { status: "published" },
    );

    assert.equal(response.representativeUserId, "rep-b");
  });
});

describe("route plan removal", () => {
  it("forbids a representative from deleting another representative's plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-b",
          status: "draft",
        }),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRoutePlan(representativeContext as never, "plan-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("rejects deleting a plan that has already been published", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
          status: "published",
        }),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRoutePlan(representativeContext as never, "plan-a"),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_PLAN_NOT_REMOVABLE");
        return true;
      },
    );
  });

  it("deletes a representative's own draft plan and records an audit event through the same transaction", async () => {
    let deleteWhere: unknown;
    const auditEvents: unknown[] = [];
    const auditClients: unknown[] = [];
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
          status: "draft",
        }),
        delete: async (args: unknown) => {
          deleteWhere = args;
          return buildFullPlan("rep-a");
        },
      },
      // Delete + audit run through one transaction; hand this same object
      // back as the transaction client so the tx-routing is observable.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
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
    const service = new RoutesService(prisma as never, audit as never);

    const response = await service.deleteRoutePlan(
      representativeContext as never,
      "plan-a",
    );

    assert.deepEqual(response, { deleted: true });
    assert.deepEqual(deleteWhere, { where: { id: "plan-a" } });
    assert.deepEqual(auditEvents, [
      {
        actorUserId: "rep-a",
        input: {
          entityType: "route_plan",
          entityId: "plan-a",
          eventType: "route_plan.deleted",
        },
      },
    ]);
    // Audited through the same transaction as the delete, so neither can
    // exist without the other.
    assert.deepEqual(auditClients, [prisma]);
  });
});

describe("route item removal", () => {
  it("forbids a representative from deleting a stop on another representative's plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-b",
        }),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRouteItem(
        representativeContext as never,
        "plan-a",
        "item-1",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_SCOPE_FORBIDDEN");
        return true;
      },
    );
  });

  it("rejects deleting a stop that does not belong to the plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findFirst: async () => null,
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRouteItem(
        representativeContext as never,
        "plan-a",
        "item-missing",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_NOT_FOUND");
        return true;
      },
    );
  });

  it("rejects removing a stop that has already been visited", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findFirst: async () =>
          buildRouteItem({ id: "item-1", status: "visited" }),
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.deleteRouteItem(
        representativeContext as never,
        "plan-a",
        "item-1",
      ),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_NOT_REMOVABLE");
        return true;
      },
    );
  });

  it("deletes a representative's own stop and records an audit event through the same transaction", async () => {
    let deleteWhere: unknown;
    const auditEvents: unknown[] = [];
    const auditClients: unknown[] = [];
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findFirst: async () =>
          buildRouteItem({ id: "item-1", locationId: "loc-1" }),
        delete: async (args: unknown) => {
          deleteWhere = args;
          return buildRouteItem({ id: "item-1" });
        },
      },
      // Delete + audit share one transaction; hand this same object back as
      // the tx client so the routing is observable (mirrors deleteRoutePlan).
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
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
    const service = new RoutesService(prisma as never, audit as never);

    const response = await service.deleteRouteItem(
      representativeContext as never,
      "plan-a",
      "item-1",
    );

    assert.deepEqual(response, { deleted: true });
    assert.deepEqual(deleteWhere, { where: { id: "item-1" } });
    assert.deepEqual(auditEvents, [
      {
        actorUserId: "rep-a",
        input: {
          entityType: "route_item",
          entityId: "item-1",
          eventType: "route_item.deleted",
          metadata: { routePlanId: "plan-a", locationId: "loc-1" },
        },
      },
    ]);
    assert.deepEqual(auditClients, [prisma]);
  });
});

describe("route item full reorder (drag-and-drop)", () => {
  it("bumps every item to a free slot before settling final sequences, in one transaction", async () => {
    const plan = { id: "plan-a", representativeUserId: "rep-a" };
    const items = [
      buildRouteItem({ id: "item-1", sequence: 1 }),
      buildRouteItem({ id: "item-2", sequence: 2 }),
      buildRouteItem({ id: "item-3", sequence: 3 }),
    ];
    const updateCalls: Array<{
      where: { id: string };
      data: { sequence: number };
    }> = [];
    let transactionCallCount = 0;
    const prisma = {
      routePlan: {
        findFirst: async () => plan,
        findUniqueOrThrow: async () => buildFullPlan("rep-a"),
      },
      routeItem: {
        findMany: async () => items,
      },
      $transaction: async (
        callback: (tx: {
          routeItem: {
            update: (args: {
              where: { id: string };
              data: { sequence: number };
            }) => Promise<unknown>;
          };
        }) => Promise<unknown>,
      ) => {
        transactionCallCount += 1;
        return callback({
          routeItem: {
            update: async (args) => {
              updateCalls.push(args);
              return {};
            },
          },
        });
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await service.reorderRouteItems(representativeContext as never, "plan-a", {
      itemIds: ["item-3", "item-1", "item-2"],
    });

    assert.equal(transactionCallCount, 1);
    assert.deepEqual(
      updateCalls.map((call) => ({
        id: call.where.id,
        sequence: call.data.sequence,
      })),
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

  it("rejects a reorder that omits one of the plan's stops", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findMany: async () => [
          buildRouteItem({ id: "item-1", sequence: 1 }),
          buildRouteItem({ id: "item-2", sequence: 2 }),
        ],
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteItems(representativeContext as never, "plan-a", {
        itemIds: ["item-1"],
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("rejects a reorder with a duplicated id", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findMany: async () => [
          buildRouteItem({ id: "item-1", sequence: 1 }),
          buildRouteItem({ id: "item-2", sequence: 2 }),
        ],
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteItems(representativeContext as never, "plan-a", {
        itemIds: ["item-1", "item-1"],
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("rejects a reorder that references a stop from another plan", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findMany: async () => [
          buildRouteItem({ id: "item-1", sequence: 1 }),
          buildRouteItem({ id: "item-2", sequence: 2 }),
        ],
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteItems(representativeContext as never, "plan-a", {
        itemIds: ["item-1", "item-from-another-plan"],
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_REORDER_INVALID");
        return true;
      },
    );
  });

  it("turns a concurrent reorder collision into a 409 instead of an unhandled 500", async () => {
    const prisma = {
      routePlan: {
        findFirst: async () => ({
          id: "plan-a",
          representativeUserId: "rep-a",
        }),
      },
      routeItem: {
        findMany: async () => [
          buildRouteItem({ id: "item-1", sequence: 1 }),
          buildRouteItem({ id: "item-2", sequence: 2 }),
        ],
      },
      $transaction: async () => {
        throw p2002();
      },
    };
    const service = new RoutesService(prisma as never, noopAudit as never);

    await assert.rejects(
      service.reorderRouteItems(representativeContext as never, "plan-a", {
        itemIds: ["item-2", "item-1"],
      }),
      (error: { getResponse?: () => { code?: string } }) => {
        assert.equal(error.getResponse?.().code, "ROUTE_ITEM_SEQUENCE_TAKEN");
        return true;
      },
    );
  });
});
