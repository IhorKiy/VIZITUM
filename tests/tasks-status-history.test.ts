import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { TasksService } from "../src/modules/tasks/tasks.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "manager-1",
    permissions: [PERMISSIONS.TASKS_UPDATE_TEAM],
    requestId: "req-1",
    ...overrides,
  } as RequestContext;
}

function buildTaskRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-01T00:00:00.000Z");

  return {
    id: "task-1",
    title: "Restock shelf",
    description: null,
    status: "in_progress",
    isPriority: false,
    assignedToUserId: "rep-1",
    assignedTo: null,
    createdByUserId: "manager-1",
    createdBy: null,
    locationId: null,
    location: null,
    visitId: null,
    reportId: null,
    dueDate: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    statusHistory: [],
    ...overrides,
  };
}

function createFakePrisma(currentStatus: "in_progress" | "done") {
  const updateCalls: Record<string, unknown>[] = [];
  const historyCreates: Record<string, unknown>[] = [];
  const prisma = {
    task: {
      findFirst: async () => ({
        id: "task-1",
        assignedToUserId: "rep-1",
        status: currentStatus,
      }),
      update: async (query: { data: Record<string, unknown> }) => {
        updateCalls.push(query.data);
        return buildTaskRow({
          status: query.data.status ?? currentStatus,
        });
      },
      findUniqueOrThrow: async () => buildTaskRow(),
    },
    taskStatusHistory: {
      create: async (query: { data: Record<string, unknown> }) => {
        historyCreates.push(query.data);
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  return { prisma, updateCalls, historyCreates };
}

describe("tasks service update status history", () => {
  it("writes a history row when the status actually changes", async () => {
    const { prisma, historyCreates } = createFakePrisma("in_progress");
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.updateTask(createContext(), "task-1", { status: "done" });

    assert.equal(historyCreates.length, 1);
    assert.deepEqual(historyCreates[0], {
      tenantId: "tenant-1",
      taskId: "task-1",
      changedByUserId: "manager-1",
      oldStatus: "in_progress",
      newStatus: "done",
    });
  });

  it("writes no history row when the patch re-sends the same status", async () => {
    const { prisma, historyCreates } = createFakePrisma("in_progress");
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.updateTask(createContext(), "task-1", {
      status: "in_progress",
    });

    assert.equal(historyCreates.length, 0);
  });

  it("writes no history row when the patch doesn't touch status", async () => {
    const { prisma, historyCreates, updateCalls } =
      createFakePrisma("in_progress");
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.updateTask(createContext(), "task-1", {
      description: "Updated details",
    });

    assert.equal(historyCreates.length, 0);
    assert.equal(updateCalls[0]?.description, "Updated details");
  });
});
