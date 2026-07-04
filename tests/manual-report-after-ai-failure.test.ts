import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VisitsService } from "../src/modules/visits/visits.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "reports.confirm_own"],
};

const managerContext = {
  requestId: "request-b",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "manager-a",
  roleCodes: ["team_manager"],
  permissions: ["reports.read_team"],
};

const createdAt = new Date("2026-06-30T10:00:00.000Z");

describe("manual report after AI failure", () => {
  it("confirms a manual report without reading failed AI job state", async () => {
    const operations: unknown[] = [];
    const visit = {
      id: "visit-a",
      tenantId: "tenant-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      routeItemId: "route-item-a",
      visitType: "planned",
      status: "in_progress",
      startedAt: createdAt,
      completedAt: null,
      cancelledAt: null,
      createdAt,
      updatedAt: createdAt,
      location: {
        id: "location-a",
        name: "Location A",
        addressLine: "Street 1",
        city: "Kyiv",
      },
      representative: {
        id: "rep-a",
        email: "rep@example.com",
        name: "Rep A",
      },
    };
    const confirmedData = {
      summary: "Manual fallback report after failed AI.",
      resultStatus: "completed",
    };
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData,
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      visit: {
        findFirst: async () => visit,
      },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      aiJob: {
        findFirst: async () => {
          throw new Error("Manual report confirmation must not read AI jobs.");
        },
      },
      task: {
        findMany: async () => [],
      },
      $transaction: async (
        callback: (transaction: {
          report: { upsert: (query: unknown) => Promise<typeof report> };
          visit: { update: (query: unknown) => Promise<void> };
          routeItem: { update: (query: unknown) => Promise<void> };
        }) => Promise<unknown>,
      ) =>
        callback({
          report: {
            upsert: async (query: unknown) => {
              operations.push({ reportUpsert: query });

              return report;
            },
          },
          visit: {
            update: async (query: unknown) => {
              operations.push({ visitUpdate: query });
            },
          },
          routeItem: {
            update: async (query: unknown) => {
              operations.push({ routeItemUpdate: query });
            },
          },
        }),
    };
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData,
      schemaVersion: "manual.v1",
    });

    assert.equal(response.id, "report-a");
    assert.equal(response.aiMetadata, report.aiMetadata);
    assert.equal(operations.length, 3);
    assert.deepEqual(
      (operations[0] as { reportUpsert: { create: { aiMetadata: unknown } } })
        .reportUpsert.create.aiMetadata,
      { source: "manual_text" },
    );
  });

  it("returns a confirmed report for manager review", async () => {
    const confirmedData = {
      summary: "Confirmed report.",
      resultStatus: "completed",
    };
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData,
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          tenantId: "tenant-a",
          locationId: "location-a",
          representativeUserId: "rep-a",
          routeItemId: null,
          visitType: "planned",
          status: "completed",
          startedAt: createdAt,
          completedAt: createdAt,
          cancelledAt: null,
          createdAt,
          updatedAt: createdAt,
          location: {
            id: "location-a",
            name: "Location A",
            addressLine: "Street 1",
            city: "Kyiv",
          },
          representative: {
            id: "rep-a",
            email: "rep@example.com",
            name: "Rep A",
          },
        }),
      },
      report: {
        findFirst: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              tenantId: "tenant-a",
              visitId: "visit-a",
            },
          });

          return report;
        },
      },
      task: {
        findMany: async () => [],
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisitReport(
      managerContext as never,
      "visit-a",
    );

    assert.equal(response.id, "report-a");
    assert.deepEqual(response.confirmedData, confirmedData);
    assert.equal(response.createdTaskCount, 0);
    assert.deepEqual(response.createdTasks, []);
  });

  it("includes created follow-up tasks linked to the confirmed report", async () => {
    const confirmedData = {
      summary: "Confirmed report with follow-up tasks.",
      resultStatus: "follow_up_required",
    };
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData,
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };
    const task = {
      id: "task-a",
      title: "Follow up on stock issue",
      status: "open",
      priority: "high",
      assignedToUserId: "rep-a",
      dueDate: new Date("2026-07-05T00:00:00.000Z"),
    };
    const prisma = {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          tenantId: "tenant-a",
          locationId: "location-a",
          representativeUserId: "rep-a",
          routeItemId: null,
          visitType: "planned",
          status: "completed",
          startedAt: createdAt,
          completedAt: createdAt,
          cancelledAt: null,
          createdAt,
          updatedAt: createdAt,
          location: {
            id: "location-a",
            name: "Location A",
            addressLine: "Street 1",
            city: "Kyiv",
          },
          representative: {
            id: "rep-a",
            email: "rep@example.com",
            name: "Rep A",
          },
        }),
      },
      report: {
        findFirst: async () => report,
      },
      task: {
        findMany: async (query: unknown) => {
          assert.deepEqual(query, {
            where: {
              tenantId: "tenant-a",
              reportId: "report-a",
              deletedAt: null,
            },
            orderBy: { createdAt: "asc" },
          });

          return [task];
        },
      },
    };
    const service = new VisitsService(prisma as never);

    const response = await service.getVisitReport(
      managerContext as never,
      "visit-a",
    );

    assert.equal(response.createdTaskCount, 1);
    assert.deepEqual(response.createdTasks, [
      {
        id: "task-a",
        title: "Follow up on stock issue",
        status: "open",
        priority: "high",
        assignedToUserId: "rep-a",
        dueDate: "2026-07-05",
      },
    ]);
  });
});
