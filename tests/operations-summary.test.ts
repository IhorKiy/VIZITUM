import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationsService } from "../src/modules/operations/operations.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

describe("operations summary", () => {
  it("aggregates production operations counters without raw content", async () => {
    const calls: Array<{ model: string; where?: unknown }> = [];
    const prisma = createPrismaStub(calls);
    const service = new OperationsService(prisma);
    const summary = await service.getSummary(
      new Date("2026-06-30T12:00:00.000Z"),
    );

    assert.equal(summary.generatedAt, "2026-06-30T12:00:00.000Z");
    assert.equal(summary.windowHours, 24);
    assert.deepEqual(summary.tenants, {
      total: 3,
      byStatus: {
        active: 2,
        pilot_active: 1,
      },
    });
    assert.deepEqual(summary.provisioning, {
      queued: 1,
      running: 2,
      failedRecent: 3,
    });
    assert.deepEqual(summary.imports, {
      failedRecent: 4,
      validationFailedRecent: 5,
      pendingConfirmation: 6,
    });
    assert.deepEqual(summary.ai, {
      queued: 7,
      running: 8,
      failedRecent: 9,
      expiredFailedAwaitingCleanup: 10,
    });
    assert.deepEqual(summary.storage, {
      expiredTemporaryAwaitingCleanup: 11,
      deletedRecent: 12,
    });
    assert.equal(
      calls.some((call) => JSON.stringify(call.where).includes("raw")),
      false,
    );
  });
});

function createPrismaStub(
  calls: Array<{ model: string; where?: unknown }>,
): PrismaService {
  let count = 0;
  const createCount =
    (model: string) => async (input?: { where?: unknown }) => {
      calls.push({ model, where: input?.where });
      count += 1;
      return count;
    };

  return {
    platformTenant: {
      groupBy: async () => [
        { status: "active", _count: { _all: 2 } },
        { status: "pilot_active", _count: { _all: 1 } },
      ],
    },
    platformProvisioningJob: {
      count: createCount("platformProvisioningJob"),
    },
    importJob: {
      count: createCount("importJob"),
    },
    aiJob: {
      count: createCount("aiJob"),
    },
    storageObject: {
      count: createCount("storageObject"),
    },
  } as unknown as PrismaService;
}
