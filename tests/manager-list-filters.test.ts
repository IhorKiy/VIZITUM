import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TasksService } from "../src/modules/tasks/tasks.service";
import { VisitsController } from "../src/modules/visits/visits.controller";
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
        groupBy: async () => [],
      },
    };
    const service = new VisitsService(prisma as never);

    await service.listVisits(managerContext as never, {
      pageSize: 25,
      representativeUserId: "rep-a",
      routePlanId: "route-a",
      startedFrom: "2026-07-01",
      startedTo: "2026-07-03",
      status: ["completed"],
    });

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      representativeUserId: "rep-a",
      routeItem: {
        tenantId: "tenant-a",
        routePlanId: "route-a",
      },
      status: "completed",
      AND: [
        {
          OR: [
            {
              startedAt: {
                gte: new Date("2026-07-01T00:00:00.000Z"),
                lte: new Date("2026-07-03T23:59:59.999Z"),
              },
            },
            {
              startedAt: null,
              createdAt: {
                gte: new Date("2026-07-01T00:00:00.000Z"),
                lte: new Date("2026-07-03T23:59:59.999Z"),
              },
            },
          ],
        },
      ],
    });
  });

  it("filters visits by a comma-separated list of statuses using an IN clause", async () => {
    let capturedWhere: unknown;
    const prisma = {
      visit: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new VisitsService(prisma as never);

    await service.listVisits(managerContext as never, {
      status: ["draft", "in_progress"],
    });

    const where = capturedWhere as {
      tenantId: string;
      status: unknown;
      AND: Array<{ OR: Array<{ startedAt?: { gte: Date; lte?: Date } }> }>;
    };

    assert.equal(where.tenantId, "tenant-a");
    assert.deepEqual(where.status, { in: ["draft", "in_progress"] });
    // Even with no period asked for, the query is floored 12 months back
    // rather than left to sweep the whole table — see the clamp coverage in
    // tests/visit-period-clamp.test.ts.
    assert.ok(where.AND[0].OR[0].startedAt?.gte instanceof Date);
    assert.equal(where.AND[0].OR[0].startedAt?.lte, undefined);
  });

  it("falls back to createdAt for the started date range when startedAt is null", async () => {
    let capturedWhere: unknown;
    const prisma = {
      visit: {
        findMany: async (query: { where: unknown }) => {
          capturedWhere = query.where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new VisitsService(prisma as never);

    await service.listVisits(managerContext as never, {
      startedFrom: "2026-07-01",
      startedTo: "2026-07-03",
    });

    // A never-started draft has no startedAt to test against the period, so
    // it must still match via createdAt or it would silently drop out of a
    // date-filtered history list and its "needs follow-up" counter. The OR
    // lives inside an AND array rather than as a bare top-level key so a
    // future filter's own OR condition can't silently overwrite this one.
    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      AND: [
        {
          OR: [
            {
              startedAt: {
                gte: new Date("2026-07-01T00:00:00.000Z"),
                lte: new Date("2026-07-03T23:59:59.999Z"),
              },
            },
            {
              startedAt: null,
              createdAt: {
                gte: new Date("2026-07-01T00:00:00.000Z"),
                lte: new Date("2026-07-03T23:59:59.999Z"),
              },
            },
          ],
        },
      ],
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
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.listTasks(managerContext as never, {
      assignedToUserId: "rep-a",
      dueFrom: "2026-07-01",
      dueTo: "2026-07-05",
      isPriority: true,
      routePlanId: "route-a",
      status: "in_progress",
    });

    assert.deepEqual(capturedWhere, {
      tenantId: "tenant-a",
      deletedAt: null,
      assignedToUserId: "rep-a",
      status: "in_progress",
      isPriority: true,
      visit: {
        tenantId: "tenant-a",
        routeItem: {
          tenantId: "tenant-a",
          routePlanId: "route-a",
        },
      },
      dueDate: {
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lte: new Date("2026-07-05T23:59:59.999Z"),
      },
    });
  });

  it("returns task location summary for field and manager task lists", async () => {
    const createdAt = new Date("2026-07-03T10:00:00.000Z");
    const prisma = {
      task: {
        findMany: async () => [
          {
            id: "task-a",
            title: "Check display",
            description: "Confirm shelf placement.",
            status: "in_progress",
            isPriority: true,
            assignedToUserId: "rep-a",
            assignedTo: {
              id: "rep-a",
              email: "rep@example.com",
              name: "Field Rep",
            },
            createdByUserId: "manager-a",
            createdBy: {
              id: "manager-a",
              email: "manager@example.com",
              name: "Manager",
            },
            locationId: "location-a",
            location: {
              id: "location-a",
              name: "Central Store",
              addressLine: "Khreshchatyk 1",
              city: "Kyiv",
            },
            visitId: null,
            reportId: null,
            dueDate: new Date("2026-07-04T00:00:00.000Z"),
            completedAt: null,
            createdAt,
            updatedAt: createdAt,
            statusHistory: [],
          },
        ],
        count: async () => 1,
      },
    };
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.listTasks(managerContext as never, {
      pageSize: 25,
    });

    assert.deepEqual(result.items[0]?.location, {
      id: "location-a",
      name: "Central Store",
      addressLine: "Khreshchatyk 1",
      city: "Kyiv",
    });
  });
});

describe("visits status query parsing", () => {
  it("parses a comma-separated status list, trimming, deduping and dropping unknown values", async () => {
    let capturedQuery: { status?: string[] } | undefined;
    const visitsService = {
      listVisits: async (_context: unknown, query: { status?: string[] }) => {
        capturedQuery = query;
        return {};
      },
    };
    const controller = new VisitsController(
      visitsService as never,
      {} as never,
    );

    await controller.listVisits({ context: managerContext } as never, {
      status: "draft, in_progress,bogus,draft",
    });

    assert.deepEqual(capturedQuery?.status, ["draft", "in_progress"]);
  });

  it("keeps a single status value working the same as before", async () => {
    let capturedQuery: { status?: string[] } | undefined;
    const visitsService = {
      listVisits: async (_context: unknown, query: { status?: string[] }) => {
        capturedQuery = query;
        return {};
      },
    };
    const controller = new VisitsController(
      visitsService as never,
      {} as never,
    );

    await controller.listVisits({ context: managerContext } as never, {
      status: "completed",
    });

    assert.deepEqual(capturedQuery?.status, ["completed"]);
  });

  it("treats an all-unknown status list as no filter", async () => {
    let capturedQuery: { status?: string[] } | undefined;
    const visitsService = {
      listVisits: async (_context: unknown, query: { status?: string[] }) => {
        capturedQuery = query;
        return {};
      },
    };
    const controller = new VisitsController(
      visitsService as never,
      {} as never,
    );

    await controller.listVisits({ context: managerContext } as never, {
      status: "bogus",
    });

    assert.equal(capturedQuery?.status, undefined);
  });
});
