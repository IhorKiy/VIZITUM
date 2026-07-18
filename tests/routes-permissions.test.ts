import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

describe("routes permissions", () => {
  it("requires a manage permission on every mutation endpoint", () => {
    const mutationHandlers = [
      RoutesController.prototype.createRoutePlan,
      RoutesController.prototype.updateRoutePlan,
      RoutesController.prototype.deleteRoutePlan,
      RoutesController.prototype.createRouteItem,
      RoutesController.prototype.updateRouteItem,
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
