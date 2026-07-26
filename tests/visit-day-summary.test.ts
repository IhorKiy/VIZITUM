import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { PERMISSIONS } from "../src/modules/roles/permissions";
import type { RequestContext } from "../src/modules/tenancy/request-context";
import { VisitsService } from "../src/modules/visits/visits.service";

function createContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    requestId: "request-a",
    tenantId: "tenant-a",
    tenantSlug: "tenant-a",
    userId: "rep-a",
    roleCodes: ["field_representative"],
    permissions: [PERMISSIONS.VISITS_READ_OWN],
    ...overrides,
  } as RequestContext;
}

type FakeVisitRow = {
  startedAt: Date | null;
  createdAt: Date;
  status: string;
};

function createFakePrisma(options: {
  timezone?: string | null;
  visits: FakeVisitRow[];
}) {
  const findManyCalls: unknown[] = [];
  const prisma = {
    platformTenant: {
      findUnique: async () =>
        options.timezone === null ? null : { timezone: options.timezone },
    },
    visit: {
      findMany: async (query: unknown) => {
        findManyCalls.push(query);
        return options.visits;
      },
    },
  };

  return { prisma, findManyCalls };
}

describe("visit day summary", () => {
  it("groups visits into calendar days in the tenant timezone, newest first", async () => {
    const { prisma } = createFakePrisma({
      timezone: "Europe/Kyiv",
      visits: [
        // 22:30 UTC on the 1st is already 01:30 on the 2nd in Kyiv (UTC+3
        // in July) — this and the COALESCE fallback below both land here.
        {
          startedAt: new Date("2026-07-01T22:30:00.000Z"),
          createdAt: new Date("2026-07-01T22:30:00.000Z"),
          status: "completed",
        },
        {
          startedAt: new Date("2026-07-01T10:00:00.000Z"),
          createdAt: new Date("2026-07-01T10:00:00.000Z"),
          status: "draft",
        },
        // Never started: buckets by createdAt, which is 00:00 on the 2nd
        // in Kyiv, same day as the visit above.
        {
          startedAt: null,
          createdAt: new Date("2026-07-01T21:00:00.000Z"),
          status: "completed",
        },
        // 23:00 UTC on the 30th is 02:00 on the 1st in Kyiv.
        {
          startedAt: new Date("2026-06-30T23:00:00.000Z"),
          createdAt: new Date("2026-06-30T23:00:00.000Z"),
          status: "in_progress",
        },
      ],
    });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(createContext(), {});

    assert.deepEqual(summary.days, [
      { day: "2026-07-02", total: 2, completed: 2 },
      { day: "2026-07-01", total: 2, completed: 0 },
    ]);
  });

  it("returns no days for an empty result set", async () => {
    const { prisma } = createFakePrisma({
      timezone: "Europe/Kyiv",
      visits: [],
    });
    const service = new VisitsService(prisma as never);

    const summary = await service.getVisitDaySummary(createContext(), {});

    assert.deepEqual(summary.days, []);
  });

  it("scopes to the caller's own visits when only visits.read_own is held", async () => {
    const { prisma, findManyCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      visits: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({
        permissions: [PERMISSIONS.VISITS_READ_OWN],
        userId: "rep-a",
      }),
      {},
    );

    assert.deepEqual(findManyCalls, [
      {
        where: { tenantId: "tenant-a", representativeUserId: "rep-a" },
        select: { startedAt: true, createdAt: true, status: true },
      },
    ]);
  });

  it("applies the status and started-date filters the caller selected", async () => {
    const { prisma, findManyCalls } = createFakePrisma({
      timezone: "Europe/Kyiv",
      visits: [],
    });
    const service = new VisitsService(prisma as never);

    await service.getVisitDaySummary(
      createContext({ permissions: [PERMISSIONS.VISITS_READ_TEAM] }),
      {
        status: "completed",
        startedFrom: "2026-07-01",
        startedTo: "2026-07-02",
      },
    );

    assert.deepEqual(findManyCalls, [
      {
        where: {
          tenantId: "tenant-a",
          status: "completed",
          startedAt: {
            gte: new Date("2026-07-01T00:00:00.000Z"),
            lte: new Date("2026-07-02T23:59:59.999Z"),
          },
        },
        select: { startedAt: true, createdAt: true, status: true },
      },
    ]);
  });

  it("rejects when the tenant cannot be resolved", async () => {
    const { prisma } = createFakePrisma({ timezone: null, visits: [] });
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      () => service.getVisitDaySummary(createContext(), {}),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TENANT_INVALID",
        );
        return true;
      },
    );
  });
});
