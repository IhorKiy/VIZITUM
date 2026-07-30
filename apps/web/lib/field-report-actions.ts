"use server";

import {
  confirmFieldVisitReport,
  createStorageObjectUploadUrl,
  registerFieldReportAudioUpload,
  registerVisitProblemPhoto,
  transcribeFieldVisitReport,
  type ApiResult,
  type PresignedUpload,
  type RegisteredAudioUpload,
  type RegisteredProblemPhoto,
  type Report,
  type TranscribeFieldReportResult,
} from "./api-client";

// A standalone "use server" module (matching zone-actions.ts) so the field
// visit-report form — a client component driving live voice capture and
// inline field validation — can call these directly as async functions
// instead of only through a <form action>. Next.js turns each export into
// its own server endpoint either way; cookies()/headers() inside
// api-client.ts resolve from the invoking request exactly as they do for a
// real form submission.
//
// Every action here carries only small JSON payloads (never the recorded
// audio itself) — Next.js's default Server Actions body limit is ~1 MB and
// applies to anything sent to a Server Action regardless of encoding. The
// recorded audio bytes travel browser -> storage directly over the presigned
// PUT URL registerFieldReportAudioAction returns (see
// field-visit-report-form.tsx), never through one of these actions.
export async function registerFieldReportAudioAction(
  visitId: string,
  input: { fileName: string; contentType: string; sizeBytes: number },
): Promise<ApiResult<RegisteredAudioUpload>> {
  return registerFieldReportAudioUpload(visitId, input);
}

// The photo bytes travel browser -> storage over the presigned PUT URL this
// returns, for the same body-limit reason as the audio above.
export async function registerProblemPhotoAction(
  visitId: string,
  input: { fileName: string; contentType: string; sizeBytes: number },
): Promise<ApiResult<RegisteredProblemPhoto>> {
  return registerVisitProblemPhoto(visitId, input);
}

// Re-signs the PUT for audio or a photo that was already registered, so a
// retry after a failed upload sends the same bytes to the same place. Retrying
// by registering again would leave a second storage object behind — and, for
// audio, a second note row on the visit — every attempt.
export async function createUploadUrlAction(
  storageObjectId: string,
): Promise<ApiResult<PresignedUpload>> {
  return createStorageObjectUploadUrl(storageObjectId);
}

export async function transcribeFieldReportAction(
  visitId: string,
  input: {
    audioObjectId: string;
    products: Array<{
      id: string;
      name: string;
      sku: string | null;
      category: string | null;
    }>;
  },
): Promise<ApiResult<TranscribeFieldReportResult>> {
  return transcribeFieldVisitReport(visitId, input);
}

export async function confirmFieldReportAction(
  visitId: string,
  confirmedData: Record<string, unknown>,
  // Present when the confirm came off the on-device queue, which can attempt the
  // same confirm more than once.
  clientRequestId?: string,
): Promise<ApiResult<Report>> {
  return confirmFieldVisitReport(visitId, confirmedData, clientRequestId);
}
