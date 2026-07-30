import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type AiJob, type SegmentTemplate } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { PERMISSIONS } from "../roles/permissions";
import { S3StorageClient } from "../storage/s3-storage.client";
import type { RequestContext } from "../tenancy/request-context";
import {
  extractTasksToCreate,
  findReportCreatedTasks,
  isRecord,
  toReportResponse,
} from "../visits/report-response.util";
import { applyShelfCheck, extractShelfCheck } from "../visits/shelf-check";
import { JsonLogger } from "../../common/json-logger.service";
import {
  classifyAiDraftQuality,
  type AiDraftQuality,
} from "./ai-draft-quality";
import {
  getAiExtractionSchema,
  type AiExtractionSchema,
} from "./ai-extraction.schemas";
import type {
  AiCleanupResult,
  AiJobResponse,
  ConfirmAiDraftResponse,
  ExtractionInput,
  FieldReportProductCatalogEntry,
  TranscribeFieldReportResult,
  TranscriptionAudioInput,
} from "./ai.types";
import {
  emptyFieldReportExtractedData,
  FIELD_REPORT_EXTRACTION_SCHEMA,
  FIELD_REPORT_EXTRACTION_SCHEMA_NAME,
  FIELD_REPORT_EXTRACTION_SYSTEM_PROMPT,
  normalizeFieldReportExtraction,
} from "./field-report-extraction.schema";
import { OpenAiExtractionClient } from "./openai-extraction.client";
import { OpenAiTranscriptionClient } from "./openai-transcription.client";

const MAX_FIELD_REPORT_PRODUCT_CATALOG_SIZE = 300;

const AI_TEMPORARY_DATA_TTL_HOURS = 24;
const OPENAI_PROVIDER = "openai";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const DEFAULT_EXTRACTION_MODEL = "gpt-4.1-mini";
const EXTRACTION_SCHEMA_VERSION = "visit-extraction.v1";

@Injectable()
export class AiService {
  private readonly logger = new JsonLogger();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transcriptionClient: OpenAiTranscriptionClient,
    private readonly extractionClient: OpenAiExtractionClient,
    private readonly s3StorageClient: S3StorageClient,
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

    const audioNote = await this.prisma.visitNote.findFirst({
      where: {
        tenantId: context.tenantId,
        visitId: visit.id,
        inputType: "audio",
        temporaryAudioObjectId: inputObject.id,
        createdByUserId: context.userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!audioNote) {
      throw new BadRequestException({
        code: "TRANSCRIPTION_INPUT_INVALID",
        message: "Input object must be registered on this visit.",
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

    this.logger.logJob({
      jobId: job.id,
      jobType: job.type,
      status: job.status,
      tenantId: job.tenantId,
      visitId: job.visitId,
      requestId: context.requestId,
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

    const runningJob = await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        startedAt: job.startedAt ?? new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    this.logger.logJob(toJobLogEntry(runningJob));

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

      this.logger.logJob(toJobLogEntry(updatedJob));

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

      this.logger.logJob(toJobLogEntry(updatedJob));

      return toAiJobResponse(updatedJob);
    }
  }

  async createExtractionJob(
    context: RequestContext,
    visitId: string,
    transcriptionJobId: string,
  ): Promise<AiJobResponse> {
    const [visit, transcriptionJob] = await Promise.all([
      this.prisma.visit.findFirst({
        where: {
          id: visitId,
          tenantId: context.tenantId,
        },
        include: {
          location: true,
        },
      }),
      this.prisma.aiJob.findFirst({
        where: {
          id: transcriptionJobId,
          tenantId: context.tenantId,
          visitId,
          type: "transcription",
          status: "succeeded",
        },
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
        message: "Extraction jobs can only be created for own visits.",
      });
    }

    if (!transcriptionJob) {
      throw new BadRequestException({
        code: "EXTRACTION_INPUT_INVALID",
        message: "Extraction requires a succeeded transcription job.",
      });
    }

    const transcriptText = extractTranscriptText(
      transcriptionJob.temporaryDraft,
    );

    if (!transcriptText) {
      throw new BadRequestException({
        code: "EXTRACTION_TRANSCRIPT_MISSING",
        message:
          "Succeeded transcription job does not include transcript text.",
      });
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { segmentTemplate: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const job = await this.prisma.aiJob.create({
      data: {
        tenantId: context.tenantId,
        visitId: visit.id,
        type: "extraction",
        status: "queued",
        provider: OPENAI_PROVIDER,
        model: getExtractionModel(),
        promptVersion: "extraction.v1",
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        inputObjectId: transcriptionJob.temporaryTranscriptObjectId,
        temporaryDraft: {
          sourceTranscriptionJobId: transcriptionJob.id,
          transcriptText,
          visitContext: {
            locationName: visit.location.name,
            visitType: visit.visitType,
            segmentTemplate: tenant.segmentTemplate,
          },
        },
        expiresAt: buildTemporaryDataExpiry(),
      },
    });

    this.logger.logJob({
      jobId: job.id,
      jobType: job.type,
      status: job.status,
      tenantId: job.tenantId,
      visitId: job.visitId,
      requestId: context.requestId,
    });

    return toAiJobResponse(job);
  }

  async runExtractionJob(jobId: string): Promise<AiJobResponse> {
    const job = await this.prisma.aiJob.findFirst({
      where: {
        id: jobId,
        type: "extraction",
      },
      include: {
        visit: true,
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

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: job.tenantId },
      select: { segmentTemplate: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const extractionInput = buildExtractionInput(
      job.temporaryDraft,
      this.getExtractionSchema(tenant.segmentTemplate),
      tenant.segmentTemplate,
    );

    const runningJob = await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        startedAt: job.startedAt ?? new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    this.logger.logJob(toJobLogEntry(runningJob));

    try {
      const extraction = await this.extractionClient.extract(
        extractionInput,
        job.model,
      );
      const draftQuality = classifyAiDraftQuality(
        extraction.draft,
        tenant.segmentTemplate,
      );
      const updatedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded",
          temporaryDraft: extraction.draft as Prisma.InputJsonObject,
          draftQuality,
          finishedAt: new Date(),
          expiresAt: job.expiresAt ?? buildTemporaryDataExpiry(),
        },
      });

      this.logger.logJob(toJobLogEntry(updatedJob));

      return toAiJobResponse(updatedJob);
    } catch (error) {
      const updatedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorCode: "EXTRACTION_FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Extraction failed.",
          finishedAt: new Date(),
          expiresAt: job.expiresAt ?? buildTemporaryDataExpiry(),
        },
      });

      this.logger.logJob(toJobLogEntry(updatedJob));

      return toAiJobResponse(updatedJob);
    }
  }

  async confirmAiDraft(
    context: RequestContext,
    visitId: string,
    extractionJobId: string,
    confirmedDataInput?: unknown,
  ): Promise<ConfirmAiDraftResponse> {
    if (
      !context.permissions.includes(PERMISSIONS.REPORTS_CONFIRM_OWN) ||
      !context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) ||
      !context.userId
    ) {
      throw new BadRequestException({
        code: "AI_DRAFT_CONFIRM_FORBIDDEN",
        message: "You cannot confirm this AI draft.",
      });
    }

    const job = await this.prisma.aiJob.findFirst({
      where: {
        id: extractionJobId,
        tenantId: context.tenantId,
        visitId,
        type: "extraction",
        status: "succeeded",
      },
      include: {
        visit: true,
      },
    });

    if (!job) {
      throw new BadRequestException({
        code: "AI_DRAFT_NOT_CONFIRMABLE",
        message: "A succeeded extraction job is required.",
      });
    }

    if (context.userId !== job.visit.representativeUserId) {
      throw new BadRequestException({
        code: "AI_VISIT_SCOPE_INVALID",
        message: "AI drafts can only be confirmed for own visits.",
      });
    }

    // Confirming flips the visit to `completed` (and the route item to
    // `visited`), which must never resurrect a cancelled visit.
    if (job.visit.status === "cancelled") {
      throw new ConflictException({
        code: "VISIT_NOT_ACTIVE",
        message: "A cancelled visit cannot receive a confirmed report.",
      });
    }

    const confirmedData =
      normalizeJsonObject(confirmedDataInput) ??
      normalizeJsonObject(job.temporaryDraft);

    if (!confirmedData) {
      throw new BadRequestException({
        code: "AI_DRAFT_INVALID",
        message: "AI draft or confirmed data must be a JSON object.",
      });
    }

    const tenant = await this.prisma.platformTenant.findUnique({
      where: { id: context.tenantId },
      select: { segmentTemplate: true },
    });

    if (!tenant) {
      throw new BadRequestException({
        code: "TENANT_INVALID",
        message: "Tenant could not be resolved.",
      });
    }

    const confirmedByUserId = context.userId;
    const edited = confirmedDataInput !== undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      const confirmedAt = new Date();
      const report = await tx.report.upsert({
        where: { visitId: job.visit.id },
        create: {
          tenantId: context.tenantId,
          visitId: job.visit.id,
          locationId: job.visit.locationId,
          representativeUserId: job.visit.representativeUserId,
          templateCode: tenant.segmentTemplate,
          schemaVersion: job.schemaVersion ?? EXTRACTION_SCHEMA_VERSION,
          status: "confirmed",
          confirmedData,
          confirmedByUserId,
          confirmedAt,
          aiMetadata: {
            source: "ai_draft",
            extractionJobId: job.id,
            provider: job.provider,
            model: job.model,
            edited,
          },
        },
        update: {
          schemaVersion: job.schemaVersion ?? EXTRACTION_SCHEMA_VERSION,
          status: "confirmed",
          confirmedData,
          confirmedByUserId,
          confirmedAt,
          aiMetadata: {
            source: "ai_draft",
            extractionJobId: job.id,
            provider: job.provider,
            model: job.model,
            edited,
          },
        },
      });

      await tx.visit.update({
        where: { id: job.visit.id },
        data: {
          status: "completed",
          completedAt: job.visit.completedAt ?? confirmedAt,
        },
      });

      if (job.visit.routeItemId) {
        await tx.routeItem.update({
          where: { id: job.visit.routeItemId },
          data: { status: "visited" },
        });
      }

      // Same contract as the manual confirm flow (visits.service.ts). An AI
      // extraction draft carries no shelf check, so this is a no-op today —
      // it exists so the two confirm paths can't drift into disagreeing about
      // what a confirmed report does to coverage.
      const shelfCheck = extractShelfCheck(confirmedData, confirmedAt);

      if (shelfCheck) {
        await applyShelfCheck(
          tx,
          context.tenantId,
          job.visit.locationId,
          shelfCheck,
        );
      }

      await tx.task.deleteMany({
        where: {
          tenantId: context.tenantId,
          reportId: report.id,
        },
      });

      const tasksToCreate = extractTasksToCreate(confirmedData);

      if (tasksToCreate.length > 0) {
        await tx.task.createMany({
          data: tasksToCreate.map((task) => ({
            tenantId: context.tenantId,
            title: task.title,
            description: task.description,
            isPriority: task.isPriority,
            assignedToUserId:
              task.assignee === "representative"
                ? job.visit.representativeUserId
                : null,
            createdByUserId: confirmedByUserId,
            locationId: job.visit.locationId,
            visitId: job.visit.id,
            reportId: report.id,
            dueDate: task.dueDate,
          })),
        });
      }

      await cleanupTemporaryAiDataAfterConfirmation(tx, {
        tenantId: context.tenantId,
        visitId: job.visit.id,
        confirmedAt,
      });

      return {
        report,
        createdTaskCount: tasksToCreate.length,
      };
    });

    const createdTasks = await findReportCreatedTasks(
      this.prisma,
      context.tenantId,
      result.report.id,
    );

    return {
      report: toReportResponse(result.report, createdTasks),
      createdTaskCount: result.createdTaskCount,
    };
  }

  // Synchronous voice-to-form flow for the field visit-report screen: unlike
  // the transcription-jobs/extraction-jobs pair above, this never persists an
  // AiJob row — it transcribes and extracts in one request and returns the
  // draft straight to the client to prefill the form. Manual report
  // confirmation (reports/confirm) must keep working even when this fails or
  // OPENAI_API_KEY is absent, so every failure degrades to an empty draft
  // instead of throwing.
  async transcribeFieldReport(
    context: RequestContext,
    visitId: string,
    input: {
      audioObjectId: string;
      products: FieldReportProductCatalogEntry[];
    },
  ): Promise<TranscribeFieldReportResult> {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, tenantId: context.tenantId },
      select: { id: true, representativeUserId: true },
    });

    if (!visit) {
      throw new NotFoundException({
        code: "VISIT_NOT_FOUND",
        message: "Visit was not found.",
      });
    }

    if (
      !context.permissions.includes(PERMISSIONS.VISITS_UPDATE_OWN) ||
      !context.permissions.includes(PERMISSIONS.AI_USE_REPORTING) ||
      context.userId !== visit.representativeUserId
    ) {
      throw new BadRequestException({
        code: "AI_VISIT_SCOPE_INVALID",
        message: "Field report transcription can only run for own visits.",
      });
    }

    // The audio itself already reached storage via a client-side presigned
    // PUT (POST /visits/:visitId/notes/audio/register), the same way the
    // async transcription-jobs pipeline requires it — mirrored here rather
    // than reused since this flow never creates an AiJob row.
    const audioObject = await this.prisma.storageObject.findFirst({
      where: {
        id: input.audioObjectId,
        tenantId: context.tenantId,
        purpose: "temporary_audio",
        status: "active",
      },
      select: { id: true, bucket: true, objectKey: true, contentType: true },
    });

    if (!audioObject) {
      throw new BadRequestException({
        code: "TRANSCRIPTION_INPUT_INVALID",
        message: "Input object must be an active temporary audio object.",
      });
    }

    const audioNote = await this.prisma.visitNote.findFirst({
      where: {
        tenantId: context.tenantId,
        visitId: visit.id,
        inputType: "audio",
        temporaryAudioObjectId: audioObject.id,
        createdByUserId: context.userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!audioNote) {
      throw new BadRequestException({
        code: "TRANSCRIPTION_INPUT_INVALID",
        message: "Input object must be registered on this visit.",
      });
    }

    let transcript: string;

    try {
      const audioBuffer = await this.s3StorageClient.downloadObject(
        audioObject.bucket,
        audioObject.objectKey,
      );
      const transcription = await this.transcriptionClient.transcribe(
        {
          fileName: "recording.webm",
          contentType: audioObject.contentType || "audio/webm",
          data: audioBuffer,
        },
        getTranscriptionModel(),
      );
      transcript = transcription.text;
    } catch (error) {
      this.logger.log({
        message: "Field report transcription failed",
        tenantId: context.tenantId,
        visitId,
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      return { transcript: "", extractedData: emptyFieldReportExtractedData() };
    }

    if (!transcript.trim()) {
      return { transcript, extractedData: emptyFieldReportExtractedData() };
    }

    try {
      const extraction = await this.extractionClient.extract(
        {
          transcript,
          schemaName: FIELD_REPORT_EXTRACTION_SCHEMA_NAME,
          schema: FIELD_REPORT_EXTRACTION_SCHEMA,
          systemPrompt: FIELD_REPORT_EXTRACTION_SYSTEM_PROMPT,
          extraContext: {
            productCatalog: input.products.slice(
              0,
              MAX_FIELD_REPORT_PRODUCT_CATALOG_SIZE,
            ),
          },
        },
        getExtractionModel(),
      );

      return {
        transcript,
        extractedData: normalizeFieldReportExtraction(extraction.draft),
      };
    } catch (error) {
      this.logger.log({
        message: "Field report extraction failed",
        tenantId: context.tenantId,
        visitId,
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
      });

      return { transcript, extractedData: emptyFieldReportExtractedData() };
    }
  }

  async cleanupExpiredFailedAiJobs(now = new Date()): Promise<AiCleanupResult> {
    const failedJobs = await this.prisma.aiJob.findMany({
      where: {
        status: "failed",
        expiresAt: { lte: now },
      },
      select: {
        id: true,
        tenantId: true,
        inputObjectId: true,
        temporaryTranscriptObjectId: true,
      },
    });

    if (failedJobs.length === 0) {
      return {
        inspectedJobCount: 0,
        expiredStorageObjectCount: 0,
        cleanedJobCount: 0,
      };
    }

    const storageObjectIdsByTenant = failedJobs.reduce<
      Map<string, Set<string>>
    >((groups, job) => {
      const storageObjectIds = groups.get(job.tenantId) ?? new Set<string>();

      if (job.inputObjectId) {
        storageObjectIds.add(job.inputObjectId);
      }

      if (job.temporaryTranscriptObjectId) {
        storageObjectIds.add(job.temporaryTranscriptObjectId);
      }

      groups.set(job.tenantId, storageObjectIds);

      return groups;
    }, new Map());
    const jobIds = failedJobs.map((job) => job.id);

    const result = await this.prisma.$transaction(async (tx) => {
      let expiredStorageObjectCount = 0;

      for (const [tenantId, storageObjectIds] of storageObjectIdsByTenant) {
        if (storageObjectIds.size === 0) {
          continue;
        }

        const updateResult = await tx.storageObject.updateMany({
          where: {
            tenantId,
            id: { in: [...storageObjectIds] },
            purpose: { in: ["temporary_audio", "temporary_transcript"] },
            status: "active",
          },
          data: {
            // Expired, not deleted. `deletedAt` means the bytes are gone from
            // R2, and only the cleanup sweep — which is the thing that actually
            // deletes them — may say so. Stamping it here recorded a deletion
            // that never happened and, because the sweep skips rows with it set,
            // guaranteed the deletion never would.
            status: "expired",
          },
        });

        expiredStorageObjectCount += updateResult.count;
      }

      const cleanedJobs = await tx.aiJob.updateMany({
        where: {
          id: { in: jobIds },
          status: "failed",
        },
        data: {
          inputObjectId: null,
          temporaryTranscriptObjectId: null,
          temporaryDraft: Prisma.DbNull,
          expiresAt: now,
        },
      });

      return {
        expiredStorageObjectCount,
        cleanedJobCount: cleanedJobs.count,
      };
    });

    this.logger.log(
      {
        message: "ai_failed_job_cleanup",
        inspectedJobCount: failedJobs.length,
        expiredStorageObjectCount: result.expiredStorageObjectCount,
        cleanedJobCount: result.cleanedJobCount,
      },
      "AiCleanup",
    );

    return {
      inspectedJobCount: failedJobs.length,
      expiredStorageObjectCount: result.expiredStorageObjectCount,
      cleanedJobCount: result.cleanedJobCount,
    };
  }
}

function toJobLogEntry(job: AiJob): {
  jobId: string;
  jobType: string;
  status: string;
  tenantId: string;
  visitId: string;
  errorCode: string | null;
  errorMessage: string | null;
} {
  return {
    jobId: job.id,
    jobType: job.type,
    status: job.status,
    tenantId: job.tenantId,
    visitId: job.visitId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  };
}

function getTranscriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL;
}

function getExtractionModel(): string {
  return process.env.OPENAI_EXTRACTION_MODEL || DEFAULT_EXTRACTION_MODEL;
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

function extractTranscriptText(value: Prisma.JsonValue): string | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }

  return value.text.trim() || null;
}

function buildExtractionInput(
  value: Prisma.JsonValue,
  schema: AiExtractionSchema,
  segmentTemplate: SegmentTemplate,
): ExtractionInput {
  if (!isRecord(value) || typeof value.transcriptText !== "string") {
    throw new BadRequestException({
      code: "EXTRACTION_INPUT_INVALID",
      message: "Extraction job is missing transcript text.",
    });
  }

  const visitContext = isRecord(value.visitContext)
    ? {
        locationName:
          typeof value.visitContext.locationName === "string"
            ? value.visitContext.locationName
            : undefined,
        visitType:
          typeof value.visitContext.visitType === "string"
            ? value.visitContext.visitType
            : undefined,
        segmentTemplate,
      }
    : { segmentTemplate };

  return {
    transcript: value.transcriptText,
    schemaName: `${segmentTemplate}_visit_extraction`,
    schema,
    visitContext,
  };
}

function normalizeJsonObject(value: unknown): Prisma.InputJsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value;
}

async function cleanupTemporaryAiDataAfterConfirmation(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    visitId: string;
    confirmedAt: Date;
  },
): Promise<void> {
  const aiJobs = await tx.aiJob.findMany({
    where: {
      tenantId: input.tenantId,
      visitId: input.visitId,
    },
    select: {
      id: true,
      inputObjectId: true,
      temporaryTranscriptObjectId: true,
    },
  });
  const storageObjectIds = new Set<string>();

  for (const aiJob of aiJobs) {
    if (aiJob.inputObjectId) {
      storageObjectIds.add(aiJob.inputObjectId);
    }

    if (aiJob.temporaryTranscriptObjectId) {
      storageObjectIds.add(aiJob.temporaryTranscriptObjectId);
    }
  }

  if (storageObjectIds.size > 0) {
    await tx.storageObject.updateMany({
      where: {
        tenantId: input.tenantId,
        id: { in: [...storageObjectIds] },
        purpose: { in: ["temporary_audio", "temporary_transcript"] },
      },
      data: {
        // Same reason as the failed-job sweep above: this marks the object done
        // with, not gone. The cleanup worker stamps `deletedAt` once the bytes
        // are actually removed.
        status: "expired",
      },
    });
  }

  await tx.aiJob.updateMany({
    where: {
      tenantId: input.tenantId,
      visitId: input.visitId,
    },
    data: {
      inputObjectId: null,
      temporaryTranscriptObjectId: null,
      temporaryDraft: Prisma.DbNull,
      expiresAt: input.confirmedAt,
    },
  });
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
    draftQuality: (job.draftQuality as unknown as AiDraftQuality) ?? undefined,
  };
}
