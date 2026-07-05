import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

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

describe("AI transcription job", () => {
  it("creates a queued transcription job for own visit audio", async () => {
    const createdJobs: unknown[] = [];
    let capturedAudioNoteQuery: unknown;
    const prisma = {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          representativeUserId: "rep-a",
        }),
      },
      storageObject: {
        findFirst: async () => ({ id: "audio-object-a" }),
      },
      visitNote: {
        findFirst: async (query: unknown) => {
          capturedAudioNoteQuery = query;

          return { id: "note-a" };
        },
      },
      aiJob: {
        create: async (query: { data: Record<string, unknown> }) => {
          createdJobs.push(query);

          return {
            id: "job-a",
            visitId: query.data.visitId,
            type: "transcription",
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
    };
    const service = new AiService(prisma as never, {} as never);

    const job = await service.createTranscriptionJob(
      context as never,
      "visit-a",
      "audio-object-a",
    );

    assert.equal(job.status, "queued");
    assert.equal(job.type, "transcription");
    assert.equal(job.inputObjectId, "audio-object-a");
    assert.deepEqual(capturedAudioNoteQuery, {
      where: {
        tenantId: "tenant-a",
        visitId: "visit-a",
        inputType: "audio",
        temporaryAudioObjectId: "audio-object-a",
        createdByUserId: "rep-a",
        deletedAt: null,
      },
      select: { id: true },
    });
    assert.deepEqual(createdJobs[0], {
      data: {
        tenantId: "tenant-a",
        visitId: "visit-a",
        type: "transcription",
        status: "queued",
        provider: "openai",
        model: "gpt-4o-transcribe",
        promptVersion: "transcription.v1",
        inputObjectId: "audio-object-a",
        expiresAt: (createdJobs[0] as { data: { expiresAt: Date } }).data
          .expiresAt,
      },
    });
  });

  it("rejects transcription input that is not registered on the same visit", async () => {
    const prisma = {
      visit: {
        findFirst: async () => ({
          id: "visit-a",
          representativeUserId: "rep-a",
        }),
      },
      storageObject: {
        findFirst: async () => ({ id: "audio-object-a" }),
      },
      visitNote: {
        findFirst: async () => null,
      },
      aiJob: {
        create: async () => {
          throw new Error("job should not be created");
        },
      },
    };
    const service = new AiService(prisma as never, {} as never);

    await assert.rejects(
      () =>
        service.createTranscriptionJob(
          context as never,
          "visit-a",
          "audio-object-a",
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "TRANSCRIPTION_INPUT_INVALID",
        );
        return true;
      },
    );
  });

  it("runs a transcription job and stores transcript metadata", async () => {
    const storageCreates: unknown[] = [];
    const jobUpdates: unknown[] = [];
    const transcriptionClient = {
      transcribe: async () => ({ text: "Transcript text" }),
    };
    const baseJob = {
      id: "job-a",
      tenantId: "tenant-a",
      visitId: "visit-a",
      type: "transcription",
      status: "queued",
      provider: "openai",
      model: "gpt-4o-transcribe",
      promptVersion: "transcription.v1",
      schemaVersion: null,
      inputObjectId: "audio-object-a",
      temporaryTranscriptObjectId: null,
      temporaryDraft: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date("2026-06-30T10:00:00.000Z"),
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      aiJob: {
        findFirst: async () => baseJob,
        update: async (query: unknown) => {
          jobUpdates.push(query);

          return {
            ...baseJob,
            status: "running",
            startedAt: createdAt,
            updatedAt: createdAt,
          };
        },
      },
      $transaction: async (
        callback: (transaction: {
          storageObject: { create: (query: unknown) => Promise<{ id: string }> };
          aiJob: { update: (query: unknown) => Promise<typeof baseJob> };
        }) => Promise<typeof baseJob>,
      ) =>
        callback({
          storageObject: {
            create: async (query: unknown) => {
              storageCreates.push(query);

              return { id: "transcript-object-a" };
            },
          },
          aiJob: {
            update: async (query: unknown) => {
              jobUpdates.push(query);

              return {
                ...baseJob,
                status: "succeeded",
                temporaryTranscriptObjectId: "transcript-object-a",
                temporaryDraft: { text: "Transcript text" },
                finishedAt: createdAt,
                updatedAt: createdAt,
              };
            },
          },
        }),
    };
    const service = new AiService(prisma as never, transcriptionClient as never);

    const job = await service.runTranscriptionJob("job-a", {
      fileName: "visit.webm",
      contentType: "audio/webm",
      data: new Uint8Array([1, 2, 3]),
    });

    assert.equal(job.status, "succeeded");
    assert.equal(job.temporaryTranscriptObjectId, "transcript-object-a");
    assert.equal(storageCreates.length, 1);
    assert.equal(jobUpdates.length, 2);
    assert.match(
      (storageCreates[0] as { data: { objectKey: string } }).data.objectKey,
      /tenants\/tenant-a\/visits\/visit-a\/transcripts\/job-a\.json/,
    );
  });
});
