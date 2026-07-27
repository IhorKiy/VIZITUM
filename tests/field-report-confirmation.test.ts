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

const createdAt = new Date("2026-07-20T09:00:00.000Z");

function buildVisit() {
  return {
    id: "visit-a",
    tenantId: "tenant-a",
    locationId: "location-a",
    representativeUserId: "rep-a",
    routeItemId: null,
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
    representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
  };
}

describe("field-report.v1 confirmation", () => {
  it("creates follow-up tasks from confirmedData.tasksToCreate", async () => {
    const operations: unknown[] = [];
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "field-report.v1",
      status: "confirmed",
      confirmedData: {},
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };
    const confirmedData = {
      summary: "Presented vitamin C. Stock is low.",
      resultStatus: "positive",
      agreements: [],
      objections: [],
      mentionedProducts: [
        { name: "Vitamin C", status: "presented", evidence: "" },
      ],
      nextActions: ["Bring samples next week"],
      tasksToCreate: [
        {
          title: "Асортимент / залишки",
          description: "Restock vitamin C",
          dueDate: "2026-07-27",
          assignee: "representative",
          isPriority: false,
        },
        {
          title: "Порожня задача",
          description: "",
          dueDate: null,
          assignee: "representative",
          isPriority: false,
        },
      ],
      locationUpdates: [],
      confidence: 1,
      requiresUserConfirmation: false,
      fieldReport: { outcome: "positive", stockStatus: "low_stock" },
    };
    const prisma = {
      visit: { findFirst: async () => buildVisit() },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      task: {
        findMany: async () => [
          {
            id: "task-a",
            title: "Асортимент / залишки",
            status: "in_progress",
            isPriority: false,
            assignedToUserId: "rep-a",
            dueDate: new Date("2026-07-27T00:00:00.000Z"),
          },
          {
            id: "task-b",
            title: "Порожня задача",
            status: "in_progress",
            isPriority: false,
            assignedToUserId: "rep-a",
            dueDate: null,
          },
        ],
      },
      $transaction: async (
        callback: (transaction: {
          report: { upsert: (query: unknown) => Promise<typeof report> };
          visit: { update: (query: unknown) => Promise<void> };
          routeItem: { update: (query: unknown) => Promise<void> };
          task: {
            deleteMany: (query: unknown) => Promise<void>;
            createMany: (query: unknown) => Promise<void>;
          };
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
          task: {
            deleteMany: async (query: unknown) => {
              operations.push({ taskDeleteMany: query });
            },
            createMany: async (query: unknown) => {
              operations.push({ taskCreateMany: query });
            },
          },
        }),
    };
    const service = new VisitsService(prisma as never);

    const response = await service.confirmReport(context as never, "visit-a", {
      confirmedData,
      schemaVersion: "field-report.v1",
    });

    assert.equal(response.id, "report-a");
    // No routeItemId on this visit, so only reportUpsert, visitUpdate,
    // taskDeleteMany and taskCreateMany run.
    assert.equal(operations.length, 4);
    assert.deepEqual(
      (operations[2] as { taskDeleteMany: { where: unknown } }).taskDeleteMany
        .where,
      { tenantId: "tenant-a", reportId: "report-a" },
    );
    const createMany = (
      operations[3] as {
        taskCreateMany: { data: Array<Record<string, unknown>> };
      }
    ).taskCreateMany.data;
    assert.equal(createMany.length, 2);
    assert.deepEqual(createMany[0], {
      tenantId: "tenant-a",
      title: "Асортимент / залишки",
      description: "Restock vitamin C",
      isPriority: false,
      assignedToUserId: "rep-a",
      createdByUserId: "rep-a",
      locationId: "location-a",
      visitId: "visit-a",
      reportId: "report-a",
      dueDate: new Date("2026-07-27T00:00:00.000Z"),
    });
    assert.equal(createMany[1].description, null);
    assert.equal(createMany[1].dueDate, null);
    assert.equal(response.createdTaskCount, 2);
    assert.equal(response.createdTasks.length, 2);
  });

  it("does not touch tasks when tasksToCreate is an empty array", async () => {
    const operations: unknown[] = [];
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "field-report.v1",
      status: "confirmed",
      confirmedData: {},
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      visit: { findFirst: async () => buildVisit() },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      task: { findMany: async () => [] },
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
      confirmedData: { summary: "No follow-up needed.", tasksToCreate: [] },
      schemaVersion: "field-report.v1",
    });

    assert.equal(response.id, "report-a");
    // No routeItemId and no tasksToCreate entries: only reportUpsert and
    // visitUpdate run.
    assert.equal(operations.length, 2);
    assert.equal(response.createdTaskCount, 0);
  });
});

// The shelf check is the only writer of assortment shelf state, and it rides
// this transaction: a stored report whose coverage was left untouched would
// put the dashboard and the visit it came from in disagreement.
describe("field-report.v1 shelf check write-back", () => {
  function buildPrisma(operations: unknown[]) {
    const report = {
      id: "report-a",
      visitId: "visit-a",
      locationId: "location-a",
      representativeUserId: "rep-a",
      templateCode: "distribution",
      schemaVersion: "field-report.v1",
      status: "confirmed",
      confirmedData: {},
      confirmedByUserId: "rep-a",
      confirmedAt: createdAt,
      aiMetadata: { source: "manual_text" },
      createdAt,
      updatedAt: createdAt,
    };

    return {
      visit: { findFirst: async () => buildVisit() },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      task: { findMany: async () => [] },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) =>
        callback({
          report: {
            upsert: async () => report,
          },
          visit: { update: async () => {} },
          routeItem: { update: async () => {} },
          locationAssortment: {
            findMany: async (query: unknown) => {
              operations.push({ assortmentFindMany: query });

              return [{ productId: "product-a" }, { productId: "product-b" }];
            },
            updateMany: async (query: unknown) => {
              operations.push({ assortmentUpdateMany: query });

              return { count: 1 };
            },
          },
        }),
    };
  }

  it("writes the location's matrix rows when the rep confirmed the check", async () => {
    const operations: unknown[] = [];
    const service = new VisitsService(buildPrisma(operations) as never);

    await service.confirmReport(context as never, "visit-a", {
      confirmedData: {
        summary: "",
        tasksToCreate: [],
        fieldReport: {
          visitDate: "2026-07-25",
          shelfChecked: true,
          productUpdates: [{ productId: "product-b", status: "out_of_stock" }],
        },
      },
      schemaVersion: "field-report.v1",
    });

    const updates = operations.filter(
      (
        operation,
      ): operation is {
        assortmentUpdateMany: {
          where: { productId: { in: string[] } };
          data: Record<string, unknown>;
        };
      } => Object.hasOwn(operation as object, "assortmentUpdateMany"),
    );

    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0]?.assortmentUpdateMany.where, {
      tenantId: "tenant-a",
      locationId: "location-a",
      productId: { in: ["product-a"] },
      // Guards against an out-of-order confirmation reinstating an older
      // shelf — see tests/shelf-check-writeback.test.ts.
      OR: [
        { lastCheckedAt: null },
        { lastCheckedAt: { lte: new Date("2026-07-25T00:00:00.000Z") } },
      ],
    });
    assert.deepEqual(updates[0]?.assortmentUpdateMany.data, {
      status: "in_stock",
      lastCheckedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
    assert.deepEqual(
      updates[1]?.assortmentUpdateMany.data.status,
      "out_of_stock",
    );
  });

  it("leaves the matrix alone when the rep never confirmed the check", async () => {
    const operations: unknown[] = [];
    const service = new VisitsService(buildPrisma(operations) as never);

    await service.confirmReport(context as never, "visit-a", {
      confirmedData: {
        summary: "",
        tasksToCreate: [],
        // The shelf panel was never opened, so `productUpdates` is empty for
        // the same reason it would be if everything were on the shelf.
        fieldReport: { visitDate: "2026-07-25", productUpdates: [] },
      },
      schemaVersion: "field-report.v1",
    });

    assert.deepEqual(operations, []);
  });
});
