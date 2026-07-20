"use server";

import {
  confirmFieldVisitReport,
  transcribeFieldVisitReport,
  type ApiResult,
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
export async function transcribeFieldReportAction(
  visitId: string,
  input: {
    audioBase64: string;
    mimeType: string;
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
): Promise<ApiResult<Report>> {
  return confirmFieldVisitReport(visitId, confirmedData);
}
