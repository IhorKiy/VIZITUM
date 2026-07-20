import type { AiJobStatus, AiJobType } from "@prisma/client";

import type { ReportResponse } from "../visits/visits.types";
import type { AiDraftQuality } from "./ai-draft-quality";
import type { FieldReportExtractedData } from "./field-report-extraction.schema";

export type CreateTranscriptionJobRequestBody = {
  inputObjectId?: unknown;
};

export type CreateExtractionJobRequestBody = {
  transcriptionJobId?: unknown;
};

export type ConfirmAiDraftRequestBody = {
  extractionJobId?: unknown;
  confirmedData?: unknown;
};

export type AiJobResponse = {
  id: string;
  visitId: string;
  type: AiJobType;
  status: AiJobStatus;
  provider: string;
  model: string;
  inputObjectId: string | null;
  temporaryTranscriptObjectId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  draftQuality?: AiDraftQuality;
};

export type ConfirmAiDraftResponse = {
  report: ReportResponse;
  createdTaskCount: number;
};

export type AiCleanupResult = {
  inspectedJobCount: number;
  expiredStorageObjectCount: number;
  cleanedJobCount: number;
};

export type TranscriptionAudioInput = {
  fileName: string;
  contentType: string;
  data: Uint8Array;
};

export type TranscriptionResult = {
  text: string;
};

export type ExtractionInput = {
  transcript: string;
  schemaName: string;
  schema: unknown;
  // Overrides the client's default system instructions — used by the field
  // report extraction, which needs SKU/task-oriented guidance instead of the
  // generic segment-template wording.
  systemPrompt?: string;
  visitContext?: {
    locationName?: string;
    visitType?: string;
    segmentTemplate?: string;
  };
  // Extra JSON merged into the user message alongside transcript/visitContext
  // (e.g. a product catalog for name/code matching context).
  extraContext?: Record<string, unknown>;
};

export type ExtractionResult = {
  draft: Record<string, unknown>;
};

export type FieldReportProductCatalogEntry = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
};

export type TranscribeFieldReportRequestBody = {
  audioBase64?: unknown;
  mimeType?: unknown;
  products?: unknown;
};

export type TranscribeFieldReportResult = {
  transcript: string;
  extractedData: FieldReportExtractedData;
};
