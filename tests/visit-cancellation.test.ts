import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { AiService } from "../src/modules/ai/ai.service";
import { VisitsService } from "../src/modules/visits/visits.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "visits.cancel_own"],
};

const createdAt = new Date("2026-07-20T09:00:00.000Z");

function buildVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: "visit-a",
    tenantId: "tenant-a",
    locationId: "location-a",
    representativeUserId: "rep-a",
    routeItemId: null,
    visitType: "planned",
    status: "in_progress",
    startedAt: createdAt,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationComment: null,
    createdAt,
    updatedAt: createdAt,
    location: {
      id: "location-a",
      name: "Location A",
      addressLine: "Street 1",
      city: "Kyiv",
    },
    representative: { id: "rep-a", email: "rep@example.com", name: "Rep A" },
    ...overrides,
  };
}

function buildPrisma(visit: ReturnType<typeof buildVisit>) {
  const operations: Array<Record<string, unknown>> = [];
  const prisma = {
    visit: {
      findFirst: async () => visit,
    },
    $transaction: async (
      callback: (transaction: {
        visit: {
          update: (query: {
            data: Record<string, unknown>;
          }) => Promise<unknown>;
        };
        routeItem: { update: (query: unknown) => Promise<void> };
      }) => Promise<unknown>,
    ) =>
      callback({
        visit: {
          update: async (query: { data: Record<string, unknown> }) => {
            operations.push({ visitUpdate: query });

            return { ...visit, ...query.data };
          },
        },
        routeItem: {
          update: async (query: unknown) => {
            operations.push({ routeItemUpdate: query });
          },
        },
      }),
  };

  return { prisma, operations };
}

describe("visit cancellation", () => {
  it("cancels an in-progress visit and skips its route stop", async () => {
    const { prisma, operations } = buildPrisma(
      buildVisit({ routeItemId: "route-item-a" }),
    );
    const service = new VisitsService(prisma as never);

    const response = await service.cancelVisit(context as never, "visit-a", {
      reason: "location_closed",
      comment: "  Closed for renovation.  ",
    });

    assert.equal(response.status, "cancelled");
    assert.equal(response.cancellationReason, "location_closed");
    assert.equal(response.cancellationComment, "Closed for renovation.");
    assert.notEqual(response.cancelledAt, null);
    assert.equal(operations.length, 2);
    const visitUpdate = (
      operations[0] as { visitUpdate: { data: Record<string, unknown> } }
    ).visitUpdate.data;
    assert.equal(visitUpdate.status, "cancelled");
    assert.equal(visitUpdate.cancellationReason, "location_closed");
    assert.equal(visitUpdate.cancellationComment, "Closed for renovation.");
    assert.ok(visitUpdate.cancelledAt instanceof Date);
    assert.deepEqual(
      (operations[1] as { routeItemUpdate: { where: unknown; data: unknown } })
        .routeItemUpdate,
      {
        where: { id: "route-item-a" },
        data: { status: "skipped", skipReason: "location_closed" },
      },
    );
  });

  it("cancels a draft visit without touching route items", async () => {
    const { prisma, operations } = buildPrisma(buildVisit({ status: "draft" }));
    const service = new VisitsService(prisma as never);

    const response = await service.cancelVisit(context as never, "visit-a", {
      reason: "client_unavailable",
    });

    assert.equal(response.status, "cancelled");
    assert.equal(response.cancellationComment, null);
    assert.equal(operations.length, 1);
  });

  it("treats an empty comment as no comment", async () => {
    const { prisma } = buildPrisma(buildVisit());
    const service = new VisitsService(prisma as never);

    const response = await service.cancelVisit(context as never, "visit-a", {
      reason: "other",
      comment: "   ",
    });

    assert.equal(response.cancellationComment, null);
  });

  it("accepts a comment of exactly 500 characters and rejects 501", async () => {
    const { prisma } = buildPrisma(buildVisit());
    const service = new VisitsService(prisma as never);

    const response = await service.cancelVisit(context as never, "visit-a", {
      reason: "other",
      comment: "x".repeat(500),
    });
    assert.equal(response.cancellationComment?.length, 500);

    await assert.rejects(
      service.cancelVisit(context as never, "visit-a", {
        reason: "other",
        comment: "x".repeat(501),
      }),
      BadRequestException,
    );
  });

  it("rejects a missing or unknown reason", async () => {
    const { prisma, operations } = buildPrisma(buildVisit());
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.cancelVisit(context as never, "visit-a", {}),
      BadRequestException,
    );
    await assert.rejects(
      service.cancelVisit(context as never, "visit-a", { reason: "sunny" }),
      BadRequestException,
    );
    assert.equal(operations.length, 0);
  });

  it("rejects completed and already-cancelled visits with a conflict", async () => {
    for (const status of ["completed", "cancelled"]) {
      const { prisma, operations } = buildPrisma(buildVisit({ status }));
      const service = new VisitsService(prisma as never);

      await assert.rejects(
        service.cancelVisit(context as never, "visit-a", {
          reason: "other",
        }),
        ConflictException,
      );
      assert.equal(operations.length, 0);
    }
  });

  it("rejects a caller who is not the visit's representative", async () => {
    const { prisma } = buildPrisma(
      buildVisit({ representativeUserId: "rep-b" }),
    );
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.cancelVisit(context as never, "visit-a", {
        reason: "other",
      }),
      ForbiddenException,
    );
  });

  it("rejects a caller without the visits.cancel_own permission", async () => {
    const { prisma } = buildPrisma(buildVisit());
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.cancelVisit(
        { ...context, permissions: ["visits.update_own"] } as never,
        "visit-a",
        { reason: "other" },
      ),
      ForbiddenException,
    );
  });

  it("no longer accepts status=cancelled through updateVisit", async () => {
    const { prisma, operations } = buildPrisma(buildVisit());
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.updateVisit(context as never, "visit-a", {
        status: "cancelled",
      }),
      BadRequestException,
    );
    assert.equal(operations.length, 0);
  });

  // The reverse direction is the one that would corrupt a row rather than just
  // duplicate the cancel path: completing a cancelled visit would leave
  // cancelledAt/cancellationReason set on a "completed" visit and revive its
  // skipped route stop.
  it("refuses any update to a cancelled visit", async () => {
    for (const body of [
      { status: "completed" },
      { status: "in_progress" },
      { startedAt: "2026-07-21T09:00:00.000Z" },
    ]) {
      const { prisma, operations } = buildPrisma(
        buildVisit({
          status: "cancelled",
          cancelledAt: createdAt,
          cancellationReason: "location_closed",
          routeItemId: "route-item-a",
        }),
      );
      const service = new VisitsService(prisma as never);

      await assert.rejects(
        service.updateVisit(context as never, "visit-a", body),
        ConflictException,
      );
      assert.equal(operations.length, 0);
    }
  });

  it("still completes a visit through updateVisit", async () => {
    const { prisma, operations } = buildPrisma(
      buildVisit({ routeItemId: "route-item-a" }),
    );
    const service = new VisitsService(prisma as never);

    const response = await service.updateVisit(context as never, "visit-a", {
      status: "completed",
    });

    assert.equal(response.status, "completed");
    assert.equal(operations.length, 2);
    assert.deepEqual(
      (operations[1] as { routeItemUpdate: { data: unknown } }).routeItemUpdate,
      {
        where: { id: "route-item-a" },
        data: { status: "visited" },
      },
    );
  });

  it("refuses to confirm a report on a cancelled visit", async () => {
    const { prisma, operations } = buildPrisma(
      buildVisit({ status: "cancelled", cancelledAt: createdAt }),
    );
    const service = new VisitsService(prisma as never);

    await assert.rejects(
      service.confirmReport(
        {
          ...context,
          permissions: ["visits.update_own", "reports.confirm_own"],
        } as never,
        "visit-a",
        { confirmedData: { summary: "ghost" } },
      ),
      ConflictException,
    );
    assert.equal(operations.length, 0);
  });

  // Mirror of the above for the AI path: both confirmation entry points flip
  // the visit to completed, so a guard on only one of them still leaves a way
  // to resurrect a cancelled visit.
  it("refuses to confirm an AI draft on a cancelled visit", async () => {
    const operations: unknown[] = [];
    const prisma = {
      // Resolved before the job lookup so the endpoint answers to a
      // `clientVisitId` as well; the guard under test sits on the job's own
      // visit either way.
      visit: {
        findFirst: async () => ({ id: "visit-a" }),
      },
      aiJob: {
        findFirst: async () => ({
          id: "extraction-job-a",
          tenantId: "tenant-a",
          visitId: "visit-a",
          type: "extraction",
          status: "succeeded",
          temporaryDraft: { summary: "ghost" },
          visit: buildVisit({
            status: "cancelled",
            cancelledAt: createdAt,
            cancellationReason: "location_closed",
          }),
        }),
      },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
      $transaction: async () => {
        operations.push("transaction");
      },
    };
    const service = new AiService(prisma as never, {} as never, {} as never);

    await assert.rejects(
      service.confirmAiDraft(
        {
          ...context,
          permissions: [
            "visits.update_own",
            "reports.confirm_own",
            "ai.use_reporting",
          ],
        } as never,
        "visit-a",
        "extraction-job-a",
      ),
      ConflictException,
    );
    assert.equal(operations.length, 0);
  });
});
