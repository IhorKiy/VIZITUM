import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import { TasksService } from "../src/modules/tasks/tasks.service";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    permissions: [PERMISSIONS.TASKS_UPDATE_TEAM],
    requestId: "req-1",
    ...overrides,
  } as RequestContext;
}

function createTask(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: "task-1",
    tenantId: "tenant-1",
    title: "Restock shelf",
    description: null,
    status: "open",
    priority: "normal",
    assignedToUserId: "user-2",
    createdByUserId: "user-1",
    locationId: null,
    visitId: null,
    reportId: null,
    dueDate: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    assignedTo: null,
    location: null,
    ...overrides,
  };
}

describe("tasks service delete", () => {
  it("soft-deletes a tenant task and records an audit event", async () => {
    const findWhere: unknown[] = [];
    const updateArgs: { where: unknown; data: Record<string, unknown> }[] = [];
    const auditEvents: unknown[] = [];
    const prisma = {
      task: {
        findFirst: async (query: { where: unknown }) => {
          findWhere.push(query.where);
          return createTask();
        },
        update: async (query: {
          where: unknown;
          data: Record<string, unknown>;
        }) => {
          updateArgs.push(query);
          return createTask({ deletedAt: query.data.deletedAt });
        },
      },
    };
    const audit = {
      recordEvent: async (
        context: RequestContext,
        input: unknown,
      ): Promise<void> => {
        auditEvents.push({ actorUserId: context.userId, input });
      },
    };
    const service = new TasksService(prisma as never, audit as never);

    const result = await service.deleteTask(createContext(), "task-1");

    // Only the request tenant's non-deleted task is targeted.
    assert.deepEqual(findWhere, [
      { id: "task-1", tenantId: "tenant-1", deletedAt: null },
    ]);
    // Update sets deletedAt (soft delete), not a hard row removal.
    assert.equal(updateArgs.length, 1);
    assert.deepEqual(updateArgs[0]?.where, { id: "task-1" });
    assert.ok(updateArgs[0]?.data.deletedAt instanceof Date);
    assert.deepEqual(result, { deleted: true });
    // The deletion is audited with the acting user and task id.
    assert.deepEqual(auditEvents, [
      {
        actorUserId: "user-1",
        input: {
          entityType: "task",
          entityId: "task-1",
          eventType: "task.deleted",
        },
      },
    ]);
  });

  it("does not delete a task from another tenant", async () => {
    let updateCalled = false;
    const prisma = {
      task: {
        findFirst: async () => null,
        update: async () => {
          updateCalled = true;
          return createTask();
        },
      },
    };
    const audit = { recordEvent: async () => {} };
    const service = new TasksService(prisma as never, audit as never);

    await assert.rejects(
      () =>
        service.deleteTask(createContext({ tenantId: "tenant-2" }), "task-1"),
      NotFoundException,
    );
    assert.equal(updateCalled, false);
  });

  it("rejects an own-scope viewer without team scope", async () => {
    let updateCalled = false;
    const auditCalls: unknown[] = [];
    const prisma = {
      task: {
        findFirst: async () => createTask({ assignedToUserId: "user-1" }),
        update: async () => {
          updateCalled = true;
          return createTask();
        },
      },
    };
    const audit = {
      recordEvent: async (_c: unknown, input: unknown) => {
        auditCalls.push(input);
      },
    };
    const service = new TasksService(prisma as never, audit as never);

    await assert.rejects(
      () =>
        service.deleteTask(
          createContext({ permissions: [PERMISSIONS.TASKS_UPDATE_OWN] }),
          "task-1",
        ),
      ForbiddenException,
    );
    // A forbidden delete leaves no write and no audit trail.
    assert.equal(updateCalled, false);
    assert.deepEqual(auditCalls, []);
  });
});
