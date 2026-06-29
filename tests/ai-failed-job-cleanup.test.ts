import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiService } from "../src/modules/ai/ai.service";

const now = new Date("2026-06-30T10:00:00.000Z");

describe("AI failed job cleanup", () => {
  it("expires temporary objects and clears failed jobs after retry window", async () => {
    const operations: unknown[] = [];
    const prisma = {
      aiJob: {
        findMany: async () => [
          {
            id: "job-a",
            tenantId: "tenant-a",
            inputObjectId: "audio-object-a",
            temporaryTranscriptObjectId: "transcript-object-a",
          },
          {
            id: "job-b",
            tenantId: "tenant-a",
            inputObjectId: "audio-object-a",
            temporaryTranscriptObjectId: null,
          },
          {
            id: "job-c",
            tenantId: "tenant-b",
            inputObjectId: "audio-object-b",
            temporaryTranscriptObjectId: null,
          },
        ],
      },
      $transaction: async (
        callback: (transaction: {
          storageObject: { updateMany: (query: unknown) => Promise<{ count: number }> };
          aiJob: { updateMany: (query: unknown) => Promise<{ count: number }> };
        }) => Promise<unknown>,
      ) =>
        callback({
          storageObject: {
            updateMany: async (query: unknown) => {
              operations.push({ storageObjectUpdateMany: query });

              return { count: 1 };
            },
          },
          aiJob: {
            updateMany: async (query: unknown) => {
              operations.push({ aiJobUpdateMany: query });

              return { count: 3 };
            },
          },
        }),
    };
    const service = new AiService(prisma as never, {} as never, {} as never);

    const result = await service.cleanupExpiredFailedAiJobs(now);

    assert.deepEqual(result, {
      inspectedJobCount: 3,
      expiredStorageObjectCount: 2,
      cleanedJobCount: 3,
    });
    assert.equal(operations.length, 3);
    assert.deepEqual(
      (operations.at(-1) as { aiJobUpdateMany: { where: unknown } })
        .aiJobUpdateMany.where,
      {
        id: { in: ["job-a", "job-b", "job-c"] },
        status: "failed",
      },
    );
  });

  it("returns zero counts when no failed jobs are expired", async () => {
    const prisma = {
      aiJob: {
        findMany: async () => [],
      },
    };
    const service = new AiService(prisma as never, {} as never, {} as never);

    assert.deepEqual(await service.cleanupExpiredFailedAiJobs(now), {
      inspectedJobCount: 0,
      expiredStorageObjectCount: 0,
      cleanedJobCount: 0,
    });
  });
});
