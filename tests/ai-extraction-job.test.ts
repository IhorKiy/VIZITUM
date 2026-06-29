import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiService } from "../src/modules/ai/ai.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "rep-a",
  roleCodes: ["field_representative"],
  permissions: ["visits.update_own", "ai.use_reporting"],
};

const createdAt = new Date("2026-06-29T10:00:00.000Z");

describe("AI extraction job", () => {
  it("creates a queued extraction job from a succeeded transcription", async () => {
    const createdJobs: unknown[] = [];
    const prisma = {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          representativeUserId: "rep-a",
          visitType: "planned",
          location: { name: "Location A" },
        }),
      },
      aiJob: {
        findFirst: async () => ({
          id: "transcription-job-a",
          temporaryTranscriptObjectId: "transcript-object-a",
          temporaryDraft: { text: "Transcript text" },
        }),
        create: async (query: { data: Record<string, unknown> }) => {
          createdJobs.push(query);

          return {
            id: "extraction-job-a",
            visitId: query.data.visitId,
            type: "extraction",
            status: "queued",
            provider: query.data.provider,
            model: query.data.model,
            inputObjectId: query.data.inputObjectId,
            temporaryTranscriptObjectId: null,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            finishedAt: null,
            expiresAt: query.data.expiresAt,
            createdAt,
            updatedAt: createdAt,
          };
        },
      },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
    };
    const service = new AiService(prisma as never, {} as never, {} as never);

    const job = await service.createExtractionJob(
      context as never,
      "visit-a",
      "transcription-job-a",
    );

    assert.equal(job.status, "queued");
    assert.equal(job.type, "extraction");
    assert.equal(job.inputObjectId, "transcript-object-a");
    assert.equal(createdJobs.length, 1);
    assert.equal(
      (createdJobs[0] as { data: { temporaryDraft: { transcriptText: string } } })
        .data.temporaryDraft.transcriptText,
      "Transcript text",
    );
  });

  it("runs extraction and stores the draft", async () => {
    const extractionCalls: unknown[] = [];
    const updates: unknown[] = [];
    const draft = {
      summary: "Visit summary",
      resultStatus: "completed",
      agreements: [],
      objections: [],
      mentionedProducts: [],
      nextActions: [],
      tasksToCreate: [],
      locationUpdates: [],
      confidence: 0.91,
      requiresUserConfirmation: true,
      templateSpecific: {
        shelfAvailabilityNotes: [],
        competitorMentions: [],
        merchandisingIssues: [],
        orderIntent: "none",
      },
    };
    const extractionClient = {
      extract: async (...args: unknown[]) => {
        extractionCalls.push(args);

        return { draft };
      },
    };
    const baseJob = {
      id: "extraction-job-a",
      tenantId: "tenant-a",
      visitId: "visit-a",
      type: "extraction",
      status: "queued",
      provider: "openai",
      model: "gpt-4.1-mini",
      promptVersion: "extraction.v1",
      schemaVersion: "visit-extraction.v1",
      inputObjectId: "transcript-object-a",
      temporaryTranscriptObjectId: null,
      temporaryDraft: {
        transcriptText: "Transcript text",
        visitContext: {
          locationName: "Location A",
          visitType: "planned",
          segmentTemplate: "distribution",
        },
      },
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date("2026-06-30T10:00:00.000Z"),
      createdAt,
      updatedAt: createdAt,
      visit: {
        id: "visit-a",
        tenantId: "tenant-a",
        representativeUserId: "rep-a",
      },
    };
    const prisma = {
      aiJob: {
        findFirst: async () => baseJob,
        update: async (query: unknown) => {
          updates.push(query);

          return {
            ...baseJob,
            ...(query as { data: Record<string, unknown> }).data,
            updatedAt: createdAt,
          };
        },
      },
      platformTenant: {
        findUnique: async () => ({ segmentTemplate: "distribution" }),
      },
    };
    const service = new AiService(
      prisma as never,
      {} as never,
      extractionClient as never,
    );

    const job = await service.runExtractionJob("extraction-job-a");

    assert.equal(job.status, "succeeded");
    assert.equal(updates.length, 2);
    assert.equal(extractionCalls.length, 1);
    assert.equal(
      (updates[1] as { data: { temporaryDraft: typeof draft } }).data
        .temporaryDraft.summary,
      "Visit summary",
    );
  });
});
