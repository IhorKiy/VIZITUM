import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TasksService } from "../src/modules/tasks/tasks.service";
import { VisitsService } from "../src/modules/visits/visits.service";

const managerContext = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: ["tasks.read_team", "visits.read_team"],
};

describe("manager list filters", () => {
  it("filters visits by route, representative, status and started date range", async () => {
    let capturedWhere: unknown;
    const prisma = {
      visit: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new VisitsService(prisma as never);

    await service.listVisits(managerContext as never, {
      pageSize: 25,
      representativeUserId: "rep-a",
      routePlanId: "route-a",
      startedFrom: "2026-07-01",
      startedTo: "2026-07-03",
      status: "completed",
    });

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      representativeUserId: "rep-a",
      routeItem: { routePlanId: "route-a" },
      status: "completed",
      startedAt: {
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lte: new Date("2026-07-03T23:59:59.999Z"),
      },
    });
  });

  it("filters tasks by route, assignee, priority, status and due date range", async () => {
    let capturedWhere: unknown;
    const prisma = {
      task: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [];
        },
        count: async () => 0,
      },
    };
    const service = new TasksService(prisma as never);

    await service.listTasks(managerContext as never, {
      assignedToUserId: "rep-a",
      dueFrom: "2026-07-01",
      dueTo: "2026-07-05",
      priority: "high",
      routePlanId: "route-a",
      status: "open",
    });

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      deletedAt: null,
      assignedToUserId: "rep-a",
      status: "open",
      priority: "high",
      visit: { routeItem: { routePlanId: "route-a" } },
      dueDate: {
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lte: new Date("2026-07-05T23:59:59.999Z"),
      },
    });
  });
});
