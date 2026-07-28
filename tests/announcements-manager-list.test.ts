import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

// Windows are expressed relative to the day the test runs, because the state
// each row reports is derived from "today" rather than stored.
function createRow(
  id: string,
  startsInDays: number,
  endsInDays: number,
  overrides: Record<string, unknown> = {},
) {
  const now = new Date();

  return {
    id,
    tenantId: "tenant-1",
    title: id,
    body: "Body.",
    startsAt: new Date(now.getTime() + startsInDays * DAY),
    endsAt: new Date(now.getTime() + endsInDays * DAY),
    createdByUserId: "manager-1",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    _count: { readReceipts: 0 },
    ...overrides,
  };
}

type Captured = {
  announcementWhere: Record<string, unknown>[];
  userWhere: Record<string, unknown>[];
  include: Record<string, unknown>[];
};

function createPrisma(
  rows: Record<string, unknown>[],
  captured: Captured,
  recipientCount = 7,
) {
  return {
    platformTenant: { findUnique: async () => ({ timezone: "Europe/Kyiv" }) },
    announcement: {
      findMany: async (query: {
        where: Record<string, unknown>;
        include: Record<string, unknown>;
      }) => {
        captured.announcementWhere.push(query.where);
        captured.include.push(query.include);
        return rows;
      },
      count: async () => rows.length,
    },
    user: {
      count: async (query: { where: Record<string, unknown> }) => {
        captured.userWhere.push(query.where);
        return recipientCount;
      },
    },
  };
}

describe("announcements manager list", () => {
  it("derives each announcement's state from its window and archive mark", async () => {
    const captured: Captured = {
      announcementWhere: [],
      userWhere: [],
      include: [],
    };
    const service = new AnnouncementsService(
      createPrisma(
        [
          createRow("starts-next-week", 7, 21),
          createRow("live-now", -3, 3),
          createRow("ended-last-week", -21, -7),
          createRow("withdrawn", -3, 3, {
            archivedAt: new Date(),
          }),
        ],
        captured,
      ) as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.listAnnouncements(managerContext(), {});

    assert.deepEqual(
      result.items.map((item) => [item.id, item.state]),
      [
        ["starts-next-week", "scheduled"],
        ["live-now", "active"],
        ["ended-last-week", "finished"],
        // Withdrawn wins over the dates: the window may still be open, but
        // nobody in the field is seeing it.
        ["withdrawn", "archived"],
      ],
    );
  });

  it("counts the reads against the representatives there are to reach", async () => {
    const captured: Captured = {
      announcementWhere: [],
      userWhere: [],
      include: [],
    };
    const service = new AnnouncementsService(
      createPrisma(
        [
          createRow("live-now", -3, 3, { _count: { readReceipts: 4 } }),
          createRow("also-live", -1, 5, { _count: { readReceipts: 0 } }),
        ],
        captured,
        7,
      ) as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.listAnnouncements(managerContext(), {});

    assert.deepEqual(
      result.items.map((item) => [item.readCount, item.recipientCount]),
      [
        [4, 7],
        [0, 7],
      ],
    );
    // One count query for the whole page, not one per row.
    assert.equal(captured.userWhere.length, 1);
    // Only active representatives count as an audience: an invited or
    // suspended account is not someone the notice can reach.
    assert.deepEqual(captured.userWhere[0], {
      tenantId: "tenant-1",
      deletedAt: null,
      status: "active",
      roles: {
        some: { tenantId: "tenant-1", roleCode: "field_representative" },
      },
    });
  });

  // A manager also holds announcements.read, so one working in the field zone
  // can leave a receipt on their own notice. Counting it would let the tally
  // read "8 of 7" — numerator and denominator have to describe the same
  // people, so the count is filtered to the same audience the denominator is.
  it("counts only representatives' receipts, matching who the denominator counts", async () => {
    const captured: Captured = {
      announcementWhere: [],
      userWhere: [],
      include: [],
    };
    const service = new AnnouncementsService(
      createPrisma([createRow("live-now", -3, 3)], captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.listAnnouncements(managerContext(), {});

    const readReceiptCount = (
      captured.include[0]?._count as {
        select: { readReceipts: { where: Record<string, unknown> } };
      }
    ).select.readReceipts;
    assert.deepEqual(readReceiptCount.where, {
      user: {
        deletedAt: null,
        status: "active",
        roles: { some: { roleCode: "field_representative" } },
      },
    });
  });

  it("scopes every state filter to the request tenant", async () => {
    const captured: Captured = {
      announcementWhere: [],
      userWhere: [],
      include: [],
    };
    const service = new AnnouncementsService(
      createPrisma([], captured) as never,
      { recordEvent: async () => {} } as never,
    );

    for (const state of [
      undefined,
      "scheduled",
      "active",
      "finished",
      "archived",
    ] as const) {
      await service.listAnnouncements(
        managerContext({ tenantId: "tenant-9" }),
        {
          state,
        },
      );
    }

    assert.equal(captured.announcementWhere.length, 5);
    for (const where of captured.announcementWhere) {
      assert.equal(where.tenantId, "tenant-9");
    }
    // The unfiltered board shows every state, so it carries no window or
    // archive condition at all.
    assert.deepEqual(captured.announcementWhere[0], { tenantId: "tenant-9" });
    assert.equal(captured.announcementWhere[1]?.archivedAt, null);
    assert.equal(captured.announcementWhere[2]?.archivedAt, null);
    assert.equal(captured.announcementWhere[3]?.archivedAt, null);
    assert.deepEqual(captured.announcementWhere[4]?.archivedAt, { not: null });
  });
});
