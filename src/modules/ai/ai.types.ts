import type { AiJobStatus, AiJobType } from "@prisma/client";

import type { AiDraftQuality } from "./ai-draft-quality";

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
  report: {
    id: string;
    visitId: string;
    locationId: string;
    representativeUserId: string;
    templateCode: string;
    schemaVersion: string;
    status: string;
    confirmedData: unknown;
    confirmedByUserId: string;
    confirmedAt: string;
    aiMetadata: unknown;
    createdAt: string;
    updatedAt: string;
  };
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
  visitContext?: {
    locationName?: string;
    visitType?: string;
    segmentTemplate?: string;
  };
};

export type ExtractionResult = {
  draft: Record<string, unknown>;
};
