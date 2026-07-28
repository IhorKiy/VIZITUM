import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";

const DAY = 24 * 60 * 60 * 1000;

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

// Windows are relative to the day the test runs, because editability is
// decided by the state the window resolves to rather than a stored column.
function createRow(
  startsInDays: number,
  endsInDays: number,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();

  return {
    id: "announcement-1",
    tenantId: "tenant-1",
    title: "August discount",
    body: "Minus 15% on the X line.",
    startsAt: new Date(now.getTime() + startsInDays * DAY),
    endsAt: new Date(now.getTime() + endsInDays * DAY),
    createdByUserId: "manager-1",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    _count: { readReceipts: 2 },
    ...overrides,
  };
}

type Harness = {
  updates: { where: unknown; data: Record<string, unknown> }[];
  auditEvents: unknown[];
  auditClients: unknown[];
  service: AnnouncementsService;
  prisma: Record<string, unknown>;
};

function createHarness(row: Record<string, unknown> | null): Harness {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const auditEvents: unknown[] = [];
  const auditClients: unknown[] = [];
  const prisma: Record<string, unknown> = {
    platformTenant: { findUnique: async () => ({ timezone: "Europe/Kyiv" }) },
    announcement: {
      findFirst: async () => row,
      update: async (query: {
        where: unknown;
        data: Record<string, unknown>;
      }) => {
        updates.push(query);
        return { ...createRow(-1, 1), ...query.data };
      },
    },
  };
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

  return {
    updates,
    auditEvents,
    auditClients,
    prisma,
    service: new AnnouncementsService(prisma as never, audit as never),
  };
}

describe("announcements update", () => {
  it("edits an announcement that is still live and audits the change", async () => {
    const h = createHarness(createRow(-1, 5));

    const result = await h.service.updateAnnouncement(
      managerContext(),
      "announcement-1",
      { title: "  -20% on the X line  " },
    );

    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0]?.data.title, "-20% on the X line");
    assert.equal(result.state, "active");
    // Editing changes text that receipts may already point at, so it leaves a
    // trail — naming which fields moved, not their values.
    assert.deepEqual(h.auditEvents, [
      {
        actorUserId: "manager-1",
        input: {
          entityType: "announcement",
          entityId: "announcement-1",
          eventType: "announcement.updated",
          metadata: { fields: ["title"] },
        },
      },
    ]);
    // Written through the same transaction as the update, so neither can
    // exist without the other.
    assert.deepEqual(h.auditClients, [h.prisma]);
  });

  it("edits an announcement that has not started yet", async () => {
    const h = createHarness(createRow(3, 10));

    await h.service.updateAnnouncement(managerContext(), "announcement-1", {
      body: "Reworded before anyone sees it.",
    });

    assert.equal(h.updates.length, 1);
  });

  // The invariant the read receipts exist to protect: they say the team read
  // *this text*. Enforced in the service, not just by hiding the UI button —
  // a direct PATCH must be refused too.
  it("refuses to edit an announcement whose window has closed", async () => {
    const h = createHarness(createRow(-30, -10));

    await assert.rejects(
      () =>
        h.service.updateAnnouncement(managerContext(), "announcement-1", {
          title: "Rewriting history",
        }),
      (error: BadRequestException) => {
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ANNOUNCEMENT_NOT_EDITABLE",
        );
        return true;
      },
    );
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.auditEvents, []);
  });

  it("refuses to edit a withdrawn announcement even inside its window", async () => {
    const h = createHarness(createRow(-1, 5, { archivedAt: new Date() }));

    await assert.rejects(
      () =>
        h.service.updateAnnouncement(managerContext(), "announcement-1", {
          body: "Quietly changed after withdrawal.",
        }),
      (error: BadRequestException) => {
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ANNOUNCEMENT_NOT_EDITABLE",
        );
        return true;
      },
    );
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.auditEvents, []);
  });

  it("validates the window as a whole when only one end moves", async () => {
    const h = createHarness(createRow(-1, 5));

    // The new end lands before the untouched start.
    await assert.rejects(
      () =>
        h.service.updateAnnouncement(managerContext(), "announcement-1", {
          endsAt: "2020-01-01",
        }),
      (error: BadRequestException) => {
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ANNOUNCEMENT_INVALID",
        );
        return true;
      },
    );
    assert.deepEqual(h.updates, []);
  });

  it("does not edit an announcement from another tenant", async () => {
    const h = createHarness(null);

    await assert.rejects(
      () =>
        h.service.updateAnnouncement(
          managerContext({ tenantId: "tenant-2" }),
          "announcement-1",
          { title: "Cross-tenant" },
        ),
      NotFoundException,
    );
    assert.deepEqual(h.updates, []);
    assert.deepEqual(h.auditEvents, []);
  });
});
