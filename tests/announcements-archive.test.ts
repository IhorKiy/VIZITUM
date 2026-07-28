import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function managerContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "manager-1",
    permissions: [PERMISSIONS.ANNOUNCEMENTS_MANAGE],
    requestId: "req-1",
    ...overrides,
  } as RequestContext;
}

function createRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-08-01T09:00:00.000Z");

  return {
    id: "announcement-1",
    tenantId: "tenant-1",
    title: "August discount",
    body: "Minus 15% on the X line.",
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-31T00:00:00.000Z"),
    createdByUserId: "manager-1",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    _count: { readReceipts: 4 },
    ...overrides,
  };
}

describe("announcements archive", () => {
  it("withdraws by stamping archivedAt and audits it in the same transaction", async () => {
    const findWhere: unknown[] = [];
    const updateArgs: { where: unknown; data: Record<string, unknown> }[] = [];
    const auditEvents: unknown[] = [];
    const auditClients: unknown[] = [];
    const prisma: Record<string, unknown> = {
      platformTenant: { findUnique: async () => ({ timezone: "Europe/Kyiv" }) },
      announcement: {
        findFirst: async (query: { where: unknown }) => {
          findWhere.push(query.where);
          return createRow();
        },
        update: async (query: {
          where: unknown;
          data: Record<string, unknown>;
        }) => {
          updateArgs.push(query);
          return createRow({ archivedAt: query.data.archivedAt });
        },
      },
    };
    // Hand the same object back as the transaction client so the routing of
    // the audit write is observable.
    prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma);
    const audit = {
      recordEvent: async (
        context: RequestContext,
        input: unknown,
        client?: unknown,
      ): Promise<void> => {
        auditEvents.push({ actorUserId: context.userId, input });
        auditClients.push(client);
      },
    };
    const service = new AnnouncementsService(prisma as never, audit as never);

    const result = await service.archiveAnnouncement(
      managerContext(),
      "announcement-1",
    );

    // Only this tenant's announcement is reachable.
    assert.deepEqual(findWhere, [
      { id: "announcement-1", tenantId: "tenant-1" },
    ]);
    // The row survives with its read receipts — withdrawal is a state change,
    // not a delete.
    assert.equal(updateArgs.length, 1);
    assert.deepEqual(updateArgs[0]?.where, { id: "announcement-1" });
    assert.ok(updateArgs[0]?.data.archivedAt instanceof Date);
    assert.equal(result.state, "archived");
    assert.deepEqual(auditEvents, [
      {
        actorUserId: "manager-1",
        input: {
          entityType: "announcement",
          entityId: "announcement-1",
          eventType: "announcement.archived",
        },
      },
    ]);
    assert.deepEqual(auditClients, [prisma]);
  });

  it("does not archive an announcement from another tenant", async () => {
    let updateCalled = false;
    const prisma = {
      platformTenant: { findUnique: async () => ({ timezone: "UTC" }) },
      announcement: {
        findFirst: async () => null,
        update: async () => {
          updateCalled = true;
          return createRow();
        },
      },
    };
    const service = new AnnouncementsService(
      prisma as never,
      {
        recordEvent: async () => {},
      } as never,
    );

    await assert.rejects(
      () =>
        service.archiveAnnouncement(
          managerContext({ tenantId: "tenant-2" }),
          "announcement-1",
        ),
      NotFoundException,
    );
    assert.equal(updateCalled, false);
  });

  it("rejects archiving twice, leaving the first withdrawal's timestamp alone", async () => {
    let updateCalled = false;
    const auditCalls: unknown[] = [];
    const prisma = {
      platformTenant: { findUnique: async () => ({ timezone: "UTC" }) },
      announcement: {
        findFirst: async () =>
          createRow({ archivedAt: new Date("2026-08-10T12:00:00.000Z") }),
        update: async () => {
          updateCalled = true;
          return createRow();
        },
      },
    };
    const audit = {
      recordEvent: async (_c: unknown, input: unknown) => {
        auditCalls.push(input);
      },
    };
    const service = new AnnouncementsService(prisma as never, audit as never);

    await assert.rejects(
      () => service.archiveAnnouncement(managerContext(), "announcement-1"),
      (error: BadRequestException) => {
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ANNOUNCEMENT_ALREADY_ARCHIVED",
        );
        return true;
      },
    );
    assert.equal(updateCalled, false);
    assert.deepEqual(auditCalls, []);
  });
});
