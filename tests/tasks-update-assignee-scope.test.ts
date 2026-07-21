import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { TasksService } from "../src/modules/tasks/tasks.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

// An own-scope-only caller may only create a task assigned to themselves
// (tests/tasks-create.test.ts). This file pins that the same restriction
// holds on PATCH: assertCanUpdateTask only checks the task's *current*
// assignee, so without a matching check on the *new* assignedToUserId, an
// own-scope caller could reassign their own task to someone else (or
// unassign it) right after creating it, trivially undoing the create-time
// restriction.
function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "rep-1",
    permissions: [PERMISSIONS.TASKS_READ_OWN, PERMISSIONS.TASKS_UPDATE_OWN],
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
    createdByUserId: "rep-1",
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

function createFakePrisma() {
  const updateCalls: Record<string, unknown>[] = [];
  const prisma = {
    task: {
      findFirst: async () => ({
        id: "task-1",
        assignedToUserId: "rep-1",
        status: "in_progress",
      }),
      update: async (query: { data: Record<string, unknown> }) => {
        updateCalls.push(query.data);
        return buildTaskRow(query.data);
      },
      findUniqueOrThrow: async () => buildTaskRow(),
    },
    user: {
      // Only reached once assertCanAssignTask has already allowed the
      // assignedToUserId through; any id offered in these tests must
      // resolve as a valid tenant user.
      findFirst: async () => ({ id: "rep-1" }),
    },
    taskStatusHistory: {
      create: async () => {},
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  return { prisma, updateCalls };
}

describe("tasks service update assignee scope", () => {
  it("rejects an own-scope-only caller reassigning their own task to someone else", async () => {
    const { prisma, updateCalls } = createFakePrisma();
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.updateTask(createContext(), "task-1", {
          assignedToUserId: "rep-2",
        }),
      ForbiddenException,
    );
    assert.equal(updateCalls.length, 0);
  });

  it("rejects an own-scope-only caller unassigning their own task", async () => {
    const { prisma, updateCalls } = createFakePrisma();
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.updateTask(createContext(), "task-1", {
          assignedToUserId: "",
        }),
      ForbiddenException,
    );
    assert.equal(updateCalls.length, 0);
  });

  it("allows an own-scope-only caller to re-send themselves as the assignee", async () => {
    const { prisma, updateCalls } = createFakePrisma();
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.updateTask(createContext(), "task-1", {
      assignedToUserId: "rep-1",
    });

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.assignedToUserId, "rep-1");
  });

  it("allows a team-scope caller to reassign a task to anyone", async () => {
    const { prisma, updateCalls } = createFakePrisma();
    const service = new TasksService(
      prisma as never,
      { recordEvent: async () => {} } as never,
    );

    await service.updateTask(
      createContext({
        userId: "manager-1",
        permissions: [PERMISSIONS.TASKS_UPDATE_TEAM],
      }),
      "task-1",
      { assignedToUserId: "rep-2" },
    );

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.assignedToUserId, "rep-2");
  });
});
