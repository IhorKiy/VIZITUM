import type {
  TaskStatus,
  VisitCancellationReason,
  VisitStatus,
} from "@prisma/client";

export type VisitResponse = {
  id: string;
  locationId: string;
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  };
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  routeItemId: string | null;
  visitType: string;
  status: VisitStatus;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: VisitCancellationReason | null;
  cancellationComment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListVisitsQuery = {
  page?: number;
  pageSize?: number;
  representativeUserId?: string;
  locationId?: string;
  routePlanId?: string;
  status?: VisitStatus[];
  startedFrom?: string;
  startedTo?: string;
};

export type VisitDaySummaryEntry = {
  // Calendar day in the tenant's timezone, YYYY-MM-DD, keyed on the same
  // COALESCE(startedAt, createdAt) moment the day-grouped history list uses.
  day: string;
  total: number;
  completed: number;
  // Cancelled visits are counted out of the day's own completion share by the
  // history list: they are closed with a reason, not work left undone, so a
  // day of four completed and four cancelled visits is finished, not half done.
  cancelled: number;
};

export type VisitDaySummaryResponse = {
  // Newest day first, one entry per day that has at least one matching visit.
  days: VisitDaySummaryEntry[];
};

export type CreateVisitRequestBody = {
  locationId?: unknown;
  representativeUserId?: unknown;
  routeItemId?: unknown;
  visitType?: unknown;
  startedAt?: unknown;
};

// Cancelling is deliberately NOT part of this body: `status: "cancelled"` is
// rejected so the only cancel path is POST /visits/:visitId/cancel, which
// requires a reason (and stamps `cancelledAt` itself).
export type UpdateVisitRequestBody = {
  status?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
};

export type CancelVisitRequestBody = {
  reason?: unknown;
  comment?: unknown;
};

export type VisitNoteResponse = {
  id: string;
  visitId: string;
  inputType: "text" | "audio";
  textContent: string | null;
  temporaryAudioObjectId: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type AddTextVisitNoteRequestBody = {
  textContent?: unknown;
};

export type RegisterAudioUploadRequestBody = {
  fileName?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
  checksum?: unknown;
};

export type RegisteredAudioUploadResponse = {
  note: VisitNoteResponse;
  storageObject: {
    id: string;
    bucket: string;
    objectKey: string;
    contentType: string;
    sizeBytes: string | null;
    checksum: string | null;
    expiresAt: string;
  };
  uploadUrl?: {
    url: string;
    method: "PUT";
    expiresAt: string;
    headers: Record<string, string>;
  };
};

export type RegisterProblemPhotoRequestBody = {
  fileName?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
};

// A problem photo is evidence attached to the visit report, not a note in its
// own right, so registering one creates only the storage object — no
// `VisitNote` row like the audio path needs for transcription.
export type RegisteredProblemPhotoResponse = {
  storageObject: {
    id: string;
    bucket: string;
    objectKey: string;
    contentType: string;
    sizeBytes: string | null;
  };
  uploadUrl?: {
    url: string;
    method: "PUT";
    expiresAt: string;
    headers: Record<string, string>;
  };
};

export type ReportCreatedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  isPriority: boolean;
  assignedToUserId: string | null;
  dueDate: string | null;
};

export type ReportResponse = {
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
  createdTaskCount: number;
  createdTasks: ReportCreatedTask[];
};

export type ConfirmReportRequestBody = {
  confirmedData?: unknown;
  schemaVersion?: unknown;
};
