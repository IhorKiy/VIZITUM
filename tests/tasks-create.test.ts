import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { TasksService } from "../src/modules/tasks/tasks.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "rep-1",
    permissions: [
      PERMISSIONS.TASKS_CREATE,
      PERMISSIONS.TASKS_READ_OWN,
      PERMISSIONS.TASKS_UPDATE_OWN,
    ],
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
    assignedTo: { id: "rep-1", email: "rep@example.com", name: "Rep" },
    createdByUserId: "rep-1",
    createdBy: { id: "rep-1", email: "rep@example.com", name: "Rep" },
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

function createFakePrisma(taskCreateData: Record<string, unknown>[]) {
  const historyCreates: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findFirst: async () => ({ id: "rep-1" }),
    },
    task: {
      create: async (query: { data: Record<string, unknown> }) => {
        taskCreateData.push(query.data);
        return buildTaskRow({
          assignedToUserId: query.data.assignedToUserId,
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

  return { prisma, historyCreates };
}

describe("tasks service create", () => {
  it("allows a team-scope caller to create a task assigned to someone else", async () => {
    const taskCreateData: Record<string, unknown>[] = [];
    const { prisma } = createFakePrisma(taskCreateData);
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.createTask(
      createContext({
        userId: "manager-1",
        permissions: [
          PERMISSIONS.TASKS_CREATE,
          PERMISSIONS.TASKS_READ_TEAM,
          PERMISSIONS.TASKS_UPDATE_TEAM,
        ],
      }),
      { title: "Restock shelf", assignedToUserId: "rep-2" },
    );

    assert.equal(taskCreateData.length, 1);
    assert.equal(taskCreateData[0]?.assignedToUserId, "rep-2");
  });

  it("allows an own-scope-only caller to create a task assigned to themselves", async () => {
    const taskCreateData: Record<string, unknown>[] = [];
    const { prisma } = createFakePrisma(taskCreateData);
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.createTask(createContext(), {
      title: "Restock shelf",
      assignedToUserId: "rep-1",
    });

    assert.equal(taskCreateData.length, 1);
    assert.equal(taskCreateData[0]?.assignedToUserId, "rep-1");
  });

  it("rejects an own-scope-only caller creating a task assigned to someone else", async () => {
    const taskCreateData: Record<string, unknown>[] = [];
    const { prisma } = createFakePrisma(taskCreateData);
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createTask(createContext(), {
          title: "Restock shelf",
          assignedToUserId: "rep-2",
        }),
      ForbiddenException,
    );
    assert.equal(taskCreateData.length, 0);
  });

  it("rejects an own-scope-only caller leaving the task unassigned", async () => {
    const taskCreateData: Record<string, unknown>[] = [];
    const { prisma } = createFakePrisma(taskCreateData);
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createTask(createContext(), {
          title: "Restock shelf",
        }),
      ForbiddenException,
    );
    assert.equal(taskCreateData.length, 0);
  });

  it("writes a creation history row in the same transaction as the task", async () => {
    const taskCreateData: Record<string, unknown>[] = [];
    const { prisma, historyCreates } = createFakePrisma(taskCreateData);
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.createTask(createContext(), {
      title: "Restock shelf",
      assignedToUserId: "rep-1",
    });

    assert.equal(historyCreates.length, 1);
    assert.deepEqual(historyCreates[0], {
      tenantId: "tenant-1",
      taskId: "task-1",
      changedByUserId: "rep-1",
      oldStatus: null,
      newStatus: "in_progress",
    });
  });
});
