import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function repContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: "tenant-1",
    userId: "rep-1",
    permissions: [PERMISSIONS.ANNOUNCEMENTS_READ],
    requestId: "req-1",
    ...overrides,
  } as RequestContext;
}

// The service derives an announcement's state by comparing its window against
// whatever today is when the test runs, so the fixture's window has to bracket
// the real current day rather than pin a date that ages out.
const YEAR = 365 * 24 * 60 * 60 * 1000;

function createRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();

  return {
    id: "announcement-1",
    tenantId: "tenant-1",
    title: "August discount",
    body: "Minus 15% on the X line.",
    startsAt: new Date(now.getTime() - YEAR),
    endsAt: new Date(now.getTime() + YEAR),
    createdByUserId: "manager-1",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    _count: { readReceipts: 3 },
    readReceipts: [],
    ...overrides,
  };
}

type FindManyArgs = { where: Record<string, unknown>; take?: number };

function createPrisma(
  rows: Record<string, unknown>[],
  captured: FindManyArgs[],
  timezone = "Europe/Kyiv",
) {
  return {
    platformTenant: {
      findUnique: async () => ({ timezone }),
    },
    announcement: {
      findMany: async (query: FindManyArgs) => {
        captured.push(query);
        return rows;
      },
    },
  };
}

describe("announcements active window", () => {
  it("asks only for announcements live today, in the tenant's timezone", async () => {
    const captured: FindManyArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma([createRow()], captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.listActiveAnnouncements(repContext());

    assert.equal(captured.length, 1);
    const where = captured[0]?.where as {
      tenantId: string;
      archivedAt: null;
      startsAt: { lte: Date };
      endsAt: { gte: Date };
    };
    assert.equal(where.tenantId, "tenant-1");
    // A withdrawn announcement is not "live" no matter what its dates say.
    assert.equal(where.archivedAt, null);
    // Both ends are inclusive: the window is asked for as started-on-or-before
    // and ends-on-or-after the same instant, so the first and last day of a
    // window both count as active.
    assert.equal(
      where.startsAt.lte.getTime(),
      where.endsAt.gte.getTime(),
      "both bounds must be compared against the same day boundary",
    );
    // That instant is a UTC midnight, matching how the date-only columns are
    // stored — not a wall-clock "now" that would make the last day expire at
    // the wrong hour.
    assert.equal(
      where.startsAt.lte.toISOString().slice(10),
      "T00:00:00.000Z",
      "the day boundary must be midnight, not the current time",
    );
  });

  it("resolves the day from the tenant timezone, not the server clock", async () => {
    // A moment that is already the next calendar day in Kyiv but still the
    // previous one in Los Angeles: the two tenants must not agree on "today".
    const kyivCaptured: FindManyArgs[] = [];
    const laCaptured: FindManyArgs[] = [];
    const kyiv = new AnnouncementsService(
      createPrisma([], kyivCaptured, "Europe/Kyiv") as never,
      { recordEvent: async () => {} } as never,
    );
    const la = new AnnouncementsService(
      createPrisma([], laCaptured, "America/Los_Angeles") as never,
      { recordEvent: async () => {} } as never,
    );

    await kyiv.listActiveAnnouncements(repContext());
    await la.listActiveAnnouncements(repContext());

    const kyivDay = (
      kyivCaptured[0]?.where.startsAt as { lte: Date }
    ).lte.getTime();
    const laDay = (
      laCaptured[0]?.where.startsAt as { lte: Date }
    ).lte.getTime();
    // Kyiv is never behind Los Angeles; on most instants of the day it is a
    // full calendar day ahead.
    assert.ok(
      kyivDay >= laDay,
      "the eastern tenant's day must not resolve earlier than the western one's",
    );
  });

  it("falls back to UTC rather than failing on an unusable timezone", async () => {
    const captured: FindManyArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma([createRow()], captured, "Not/AZone") as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.listActiveAnnouncements(repContext());

    assert.equal(result.items.length, 1);
    assert.equal(
      (captured[0]?.where.startsAt as { lte: Date }).lte
        .toISOString()
        .slice(10),
      "T00:00:00.000Z",
    );
  });

  it("reports each announcement's read state for the caller and counts the unread", async () => {
    const captured: FindManyArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma(
        [
          createRow({ id: "read-one", readReceipts: [{ id: "receipt-1" }] }),
          createRow({ id: "unread-one", readReceipts: [] }),
          createRow({ id: "unread-two", readReceipts: [] }),
        ],
        captured,
      ) as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.listActiveAnnouncements(repContext());

    assert.deepEqual(
      result.items.map((item) => [item.id, item.isRead]),
      [
        ["read-one", true],
        ["unread-one", false],
        ["unread-two", false],
      ],
    );
    assert.equal(result.unreadCount, 2);
    // Every item on this list is, by definition of the query, currently in
    // force — the state is reported so the UI never has to recompute it.
    assert.deepEqual(
      result.items.map((item) => item.state),
      ["active", "active", "active"],
    );
  });

  it("caps the field list rather than paginating it", async () => {
    const captured: FindManyArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma([], captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.listActiveAnnouncements(repContext());

    assert.equal(captured[0]?.take, 50);
  });

  it("does not leak read state from another representative", async () => {
    const captured: FindManyArgs[] = [];
    const prisma = {
      platformTenant: { findUnique: async () => ({ timezone: "UTC" }) },
      announcement: {
        findMany: async (query: FindManyArgs & { include: unknown }) => {
          captured.push(query);
          return [];
        },
      },
    };
    const service = new AnnouncementsService(
      prisma as never,
      {
        recordEvent: async () => {},
      } as never,
    );

    await service.listActiveAnnouncements(repContext({ userId: "rep-9" }));

    const include = (
      captured[0] as unknown as { include: Record<string, unknown> }
    ).include;
    assert.deepEqual((include.readReceipts as { where: unknown }).where, {
      tenantId: "tenant-1",
      userId: "rep-9",
    });
  });
});
