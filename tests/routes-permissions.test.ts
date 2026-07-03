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
    const service = new RoutesService(prisma as never);

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
    const service = new RoutesService({} as never);

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
    const service = new RoutesService(prisma as never);

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
    const service = new RoutesService(prisma as never);

    const response = await service.updateRoutePlan(
      managerContext as never,
      "plan-a",
      { status: "published" },
    );

    assert.equal(response.representativeUserId, "rep-b");
  });
});
