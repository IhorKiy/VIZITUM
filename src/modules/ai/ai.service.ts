import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AiJob, Prisma, SegmentTemplate } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  getAiExtractionSchema,
  type AiExtractionSchema,
} from "./ai-extraction.schemas";
import type {
  AiJobResponse,
  TranscriptionAudioInput,
} from "./ai.types";
import { OpenAiTranscriptionClient } from "./openai-transcription.client";

const AI_TEMPORARY_DATA_TTL_HOURS = 24;
const OPENAI_PROVIDER = "openai";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transcriptionClient: OpenAiTranscriptionClient,
  ) {}

  getExtractionSchema(segmentTemplate: SegmentTemplate): AiExtractionSchema {
    return getAiExtractionSchema(segmentTemplate);
  }

  async createTranscriptionJob(
    context: RequestContext,
    visitId: string,
    inputObjectId: string,
  ): Promise<AiJobResponse> {
    const [visit, inputObject] = await Promise.all([
      this.prisma.visit.findFirst({
        where: {
          id: visitId,
          tenantId: context.tenantId,
        },
        select: { id: true, representativeUserId: true },
      }),
      this.prisma.storageObject.findFirst({
        where: {
          id: inputObjectId,
          tenantId: context.tenantId,
          purpose: "temporary_audio",
          status: "active",
        },
        select: { id: true },
      }),
    ]);

    if (!visit) {
      throw new NotFoundException({
        code: "VISIT_NOT_FOUND",
        message: "Visit was not found.",
      });
    }

    if (
      !context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) ||
      context.userId !== visit.representativeUserId
    ) {
      throw new BadRequestException({
        code: "AI_VISIT_SCOPE_INVALID",
        message: "Transcription jobs can only be created for own visits.",
      });
    }

    if (!inputObject) {
      throw new BadRequestException({
        code: "TRANSCRIPTION_INPUT_INVALID",
        message: "Input object must be an active temporary audio object.",
      });
    }

    const job = await this.prisma.aiJob.create({
      data: {
        tenantId: context.tenantId,
        visitId: visit.id,
        type: "transcription",
        status: "queued",
        provider: OPENAI_PROVIDER,
        model: getTranscriptionModel(),
        promptVersion: "transcription.v1",
        inputObjectId: inputObject.id,
        expiresAt: buildTemporaryDataExpiry(),
      },
    });

    return toAiJobResponse(job);
  }

  async runTranscriptionJob(
    jobId: string,
    audio: TranscriptionAudioInput,
  ): Promise<AiJobResponse> {
    const job = await this.prisma.aiJob.findFirst({
      where: {
        id: jobId,
        type: "transcription",
      },
    });

    if (!job) {
      throw new NotFoundException({
        code: "AI_JOB_NOT_FOUND",
        message: "AI job was not found.",
      });
    }

    if (job.status === "succeeded" || job.status === "cancelled") {
      return toAiJobResponse(job);
    }

    await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        startedAt: job.startedAt ?? new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    try {
      const transcription = await this.transcriptionClient.transcribe(
        audio,
        job.model,
      );
      const transcriptPayload = {
        text: transcription.text,
        provider: job.provider,
        model: job.model,
      } satisfies Prisma.InputJsonObject;
      const transcriptBytes = Buffer.byteLength(
        JSON.stringify(transcriptPayload),
        "utf8",
      );
      const expiresAt = job.expiresAt ?? buildTemporaryDataExpiry();

      const updatedJob = await this.prisma.$transaction(async (tx) => {
        const transcriptObject = await tx.storageObject.create({
          data: {
            tenantId: job.tenantId,
            bucket: process.env.S3_BUCKET || "vizitum",
            objectKey: buildTemporaryTranscriptObjectKey(job),
            purpose: "temporary_transcript",
            contentType: "application/json",
            sizeBytes: BigInt(transcriptBytes),
            status: "active",
            expiresAt,
          },
        });

        return tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: "succeeded",
            temporaryTranscriptObjectId: transcriptObject.id,
            temporaryDraft: transcriptPayload,
            finishedAt: new Date(),
            expiresAt,
          },
        });
      });

      return toAiJobResponse(updatedJob);
    } catch (error) {
      const updatedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorCode: "TRANSCRIPTION_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Transcription failed.",
          finishedAt: new Date(),
          expiresAt: job.expiresAt ?? buildTemporaryDataExpiry(),
        },
      });

      return toAiJobResponse(updatedJob);
    }
  }
}

function getTranscriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL;
}

function buildTemporaryDataExpiry(): Date {
  return new Date(Date.now() + AI_TEMPORARY_DATA_TTL_HOURS * 60 * 60 * 1000);
}

function buildTemporaryTranscriptObjectKey(job: AiJob): string {
  return [
    "tenants",
    job.tenantId,
    "visits",
    job.visitId,
    "transcripts",
    `${job.id}.json`,
  ].join("/");
}

function toAiJobResponse(job: AiJob): AiJobResponse {
  return {
    id: job.id,
    visitId: job.visitId,
    type: job.type,
    status: job.status,
    provider: job.provider,
    model: job.model,
    inputObjectId: job.inputObjectId,
    temporaryTranscriptObjectId: job.temporaryTranscriptObjectId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
