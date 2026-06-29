import type { AiJobStatus, AiJobType } from "@prisma/client";

export type CreateTranscriptionJobRequestBody = {
  inputObjectId?: unknown;
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
};

export type TranscriptionAudioInput = {
  fileName: string;
  contentType: string;
  data: Uint8Array;
};

export type TranscriptionResult = {
  text: string;
};
