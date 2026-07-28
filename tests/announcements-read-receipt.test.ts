import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

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

type UpsertArgs = {
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function createPrisma(options: {
  found: boolean;
  findWhere: Record<string, unknown>[];
  upserts: UpsertArgs[];
}) {
  return {
    platformTenant: { findUnique: async () => ({ timezone: "Europe/Kyiv" }) },
    announcement: {
      findFirst: async (query: { where: Record<string, unknown> }) => {
        options.findWhere.push(query.where);
        return options.found ? { id: "announcement-1" } : null;
      },
    },
    announcementReadReceipt: {
      upsert: async (query: UpsertArgs) => {
        options.upserts.push(query);
        return { id: "receipt-1" };
      },
    },
  };
}

describe("announcements read receipts", () => {
  it("records a receipt keyed on tenant, announcement and the calling user", async () => {
    const findWhere: Record<string, unknown>[] = [];
    const upserts: UpsertArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma({ found: true, findWhere, upserts }) as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.markAnnouncementRead(
      repContext(),
      "announcement-1",
    );

    assert.deepEqual(result, { read: true });
    assert.equal(upserts.length, 1);
    assert.deepEqual(upserts[0]?.where, {
      tenantId_announcementId_userId: {
        tenantId: "tenant-1",
        announcementId: "announcement-1",
        userId: "rep-1",
      },
    });
    // The user comes from the session, never from the request — one
    // representative cannot mark an announcement read on another's behalf.
    assert.equal(upserts[0]?.create.userId, "rep-1");
    assert.equal(upserts[0]?.create.tenantId, "tenant-1");
  });

  it("is idempotent: a second tap keeps the original readAt", async () => {
    const findWhere: Record<string, unknown>[] = [];
    const upserts: UpsertArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma({ found: true, findWhere, upserts }) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.markAnnouncementRead(repContext(), "announcement-1");
    await service.markAnnouncementRead(repContext(), "announcement-1");

    assert.equal(upserts.length, 2);
    // An empty update is what makes "read" mean "first saw it": re-tapping
    // must not move the timestamp forward.
    assert.deepEqual(upserts[0]?.update, {});
    assert.deepEqual(upserts[1]?.update, {});
  });

  it("only accepts an announcement the caller can actually see", async () => {
    const findWhere: Record<string, unknown>[] = [];
    const upserts: UpsertArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma({ found: true, findWhere, upserts }) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.markAnnouncementRead(repContext(), "announcement-1");

    const where = findWhere[0] as {
      id: string;
      tenantId: string;
      archivedAt: null;
      startsAt: { lte: Date };
      endsAt: { gte: Date };
    };
    assert.equal(where.id, "announcement-1");
    assert.equal(where.tenantId, "tenant-1");
    // A scheduled or withdrawn announcement was never on the rep's screen, so
    // it cannot collect a receipt saying they read it.
    assert.equal(where.archivedAt, null);
    assert.ok(where.startsAt.lte instanceof Date);
    assert.ok(where.endsAt.gte instanceof Date);
  });

  it("rejects an announcement from another tenant without writing", async () => {
    const findWhere: Record<string, unknown>[] = [];
    const upserts: UpsertArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma({ found: false, findWhere, upserts }) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.markAnnouncementRead(
          repContext({ tenantId: "tenant-2" }),
          "announcement-1",
        ),
      NotFoundException,
    );
    assert.deepEqual(upserts, []);
    assert.equal(findWhere[0]?.tenantId, "tenant-2");
  });

  it("refuses a credential with no user behind it", async () => {
    const findWhere: Record<string, unknown>[] = [];
    const upserts: UpsertArgs[] = [];
    const service = new AnnouncementsService(
      createPrisma({ found: true, findWhere, upserts }) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.markAnnouncementRead(
          repContext({ userId: undefined }),
          "announcement-1",
        ),
      ForbiddenException,
    );
    assert.deepEqual(upserts, []);
    // Nothing is even looked up: there is no user to record a receipt for.
    assert.deepEqual(findWhere, []);
  });
});
