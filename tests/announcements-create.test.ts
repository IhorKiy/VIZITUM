import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { AnnouncementsService } from "../src/modules/announcements/announcements.service";
import {
  ANNOUNCEMENT_BODY_MAX_LENGTH,
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
} from "../src/modules/announcements/announcements.types";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";

function createContext(
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
    _count: { readReceipts: 0 },
    ...overrides,
  };
}

function createPrisma(captured: { data: Record<string, unknown>[] }) {
  return {
    platformTenant: {
      findUnique: async () => ({ timezone: "Europe/Kyiv" }),
    },
    announcement: {
      create: async (query: { data: Record<string, unknown> }) => {
        captured.data.push(query.data);
        return createRow(query.data);
      },
    },
  };
}

describe("announcements service create", () => {
  it("stores the tenant from the request context and the acting author", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    const result = await service.createAnnouncement(
      // A tenant id in the body must never win over the session's — it is not
      // even read.
      createContext({ tenantId: "tenant-1" }),
      {
        title: "  August discount  ",
        body: "  Minus 15% on the X line.  ",
        startsAt: "2026-08-01",
        endsAt: "2026-08-31",
      },
    );

    assert.equal(captured.data.length, 1);
    assert.equal(captured.data[0]?.tenantId, "tenant-1");
    assert.equal(captured.data[0]?.createdByUserId, "manager-1");
    // Surrounding whitespace is trimmed, not stored.
    assert.equal(captured.data[0]?.title, "August discount");
    assert.equal(captured.data[0]?.body, "Minus 15% on the X line.");
    // Date-only columns land on UTC midnight so they compare directly against
    // the tenant's calendar day.
    assert.equal(
      (captured.data[0]?.startsAt as Date).toISOString(),
      "2026-08-01T00:00:00.000Z",
    );
    assert.equal(result.startsAt, "2026-08-01");
    assert.equal(result.endsAt, "2026-08-31");
  });

  it("rejects an end date before the start date", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "Backwards window",
          body: "Ends before it starts.",
          startsAt: "2026-08-31",
          endsAt: "2026-08-01",
        }),
      (error: BadRequestException) => {
        const response = error.getResponse() as {
          code: string;
          fieldErrors: Record<string, string[]>;
        };
        assert.equal(response.code, "ANNOUNCEMENT_INVALID");
        assert.ok(response.fieldErrors.endsAt);
        return true;
      },
    );
    assert.deepEqual(captured.data, []);
  });

  it("accepts a single-day window", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await service.createAnnouncement(createContext(), {
      title: "One day only",
      body: "Today.",
      startsAt: "2026-08-05",
      endsAt: "2026-08-05",
    });

    assert.equal(captured.data.length, 1);
  });

  it("requires a title and a body", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "   ",
          body: "Body without a title.",
          startsAt: "2026-08-01",
          endsAt: "2026-08-31",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "Title without a body",
          body: "",
          startsAt: "2026-08-01",
          endsAt: "2026-08-31",
        }),
      BadRequestException,
    );
    assert.deepEqual(captured.data, []);
  });

  it("rejects text past the limits the form advertises", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "t".repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH + 1),
          body: "Fine.",
          startsAt: "2026-08-01",
          endsAt: "2026-08-31",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "Fine",
          body: "b".repeat(ANNOUNCEMENT_BODY_MAX_LENGTH + 1),
          startsAt: "2026-08-01",
          endsAt: "2026-08-31",
        }),
      BadRequestException,
    );
    assert.deepEqual(captured.data, []);
  });

  it("rejects a window that is not a plain calendar date", async () => {
    const captured = { data: [] as Record<string, unknown>[] };
    const service = new AnnouncementsService(
      createPrisma(captured) as never,
      { recordEvent: async () => {} } as never,
    );

    await assert.rejects(
      () =>
        service.createAnnouncement(createContext(), {
          title: "Timestamped",
          body: "Window carries a time.",
          startsAt: "2026-08-01T10:00:00.000Z",
          endsAt: "2026-08-31",
        }),
      (error: BadRequestException) => {
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "DATE_INVALID",
        );
        return true;
      },
    );
    assert.deepEqual(captured.data, []);
  });
});
