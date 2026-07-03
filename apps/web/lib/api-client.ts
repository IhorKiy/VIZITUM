import { cookies, headers } from "next/headers";

export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    lastSelectedRoleCode: string | null;
  };
  roleCodes: string[];
  permissions: string[];
};

export type VisitStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type RouteStatus =
  "draft" | "published" | "in_progress" | "completed" | "cancelled";
export type RouteItemStatus =
  "planned" | "in_progress" | "completed" | "skipped";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";
export type TenantRoleCode =
  "company_admin" | "team_manager" | "field_representative";
export type TenantUserStatus = "active" | "invited" | "suspended";
export type ProductStatus = "active" | "inactive" | "archived";
export type LocationStatus = "active" | "inactive" | "archived";

export type Visit = {
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
  createdAt: string;
  updatedAt: string;
};

export type Location = {
  id: string;
  externalCode: string | null;
  name: string;
  type: string | null;
  status: LocationStatus;
  addressLine: string;
  city: string;
  region: string | null;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Product = {
  id: string;
  externalCode: string | null;
  name: string;
  sku: string | null;
  category: string | null;
  status: ProductStatus;
  notApplicable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RoutePlan = {
  id: string;
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  planDate: string;
  status: RouteStatus;
  publishedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    locationId: string;
    location: {
      id: string;
      name: string;
      addressLine: string;
      city: string;
    };
    sequence: number;
    status: RouteItemStatus;
    plannedStartTime: string | null;
    plannedEndTime: string | null;
    skipReason: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedToUserId: string | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdByUserId: string | null;
  locationId: string | null;
  visitId: string | null;
  reportId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TenantUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: TenantUserStatus;
  lastSelectedRoleCode: TenantRoleCode | null;
  roleCodes: TenantRoleCode[];
  createdAt: string;
  updatedAt: string;
};

export type TenantSettings = {
  tenantId: string;
  name: string;
  timezone: string;
  productMode: string;
  productsEnabled: boolean;
  updatedAt: string;
};

export type InviteUserResult = {
  id: string;
  email: string;
  roleCodes: TenantRoleCode[];
  status: string;
  expiresAt: string;
  token: string;
};

export type InviteHistoryItem = {
  id: string;
  email: string;
  roleCodes: TenantRoleCode[];
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  acceptedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
};

export type PaginatedResponse<TItem> = {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ImportTemplateSummary = {
  type: string;
  label: string;
  fileName: string;
  downloadPath: string;
  requiredColumns: string[];
  optionalColumns: string[];
};

export type ImportValidationIssue = {
  rowNumber: number;
  fieldName?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
  rawValue?: string;
};

export type StoredImportValidationPreview = {
  templateType: string;
  rowCount: number;
  validRowCount: number;
  errorRowCount: number;
  warningRowCount: number;
  canConfirm: boolean;
  issues: ImportValidationIssue[];
  importJobId: string;
  status: "validated" | "validation_failed";
};

export type ImportApplyResult = {
  importJobId: string;
  status: "applied";
  appliedRowCount: number;
  createdCounts: Record<string, number>;
};

export type ImportJobHistoryItem = {
  id: string;
  templateType: string;
  status:
    | "uploaded"
    | "validated"
    | "validation_failed"
    | "confirmed"
    | "applied"
    | "failed"
    | "cancelled";
  rowCount: number;
  validRowCount: number;
  errorRowCount: number;
  warningRowCount: number;
  uploadedBy: {
    id: string;
    email: string;
    name: string;
  };
  confirmedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdCounts: Record<string, number> | null;
  createdAt: string;
  validatedAt: string | null;
  confirmedAt: string | null;
  appliedAt: string | null;
  failedAt: string | null;
};

export type OperationsSummary = {
  generatedAt: string;
  windowHours: number;
  tenants: {
    total: number;
    byStatus: Record<string, number>;
  };
  provisioning: {
    queued: number;
    running: number;
    failedRecent: number;
  };
  imports: {
    failedRecent: number;
    validationFailedRecent: number;
    pendingConfirmation: number;
  };
  ai: {
    queued: number;
    running: number;
    failedRecent: number;
    expiredFailedAwaitingCleanup: number;
  };
  storage: {
    expiredTemporaryAwaitingCleanup: number;
    deletedRecent: number;
  };
  requestId?: string;
};

export type Report = {
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

export type VisitNote = {
  id: string;
  visitId: string;
  inputType: "text" | "audio";
  textContent: string | null;
  temporaryAudioObjectId: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type RegisteredAudioUpload = {
  note: VisitNote;
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

export type ApiResult<TData> =
  { ok: true; data: TData } | { ok: false; status: number; message: string };

export async function getCurrentSession(): Promise<ApiResult<AuthSession>> {
  return apiGet<AuthSession>("/auth/me");
}

export async function listVisits(
  query = "pageSize=50",
): Promise<ApiResult<PaginatedResponse<Visit>>> {
  return apiGet<PaginatedResponse<Visit>>(`/visits?${query}`);
}

export async function listAllVisits(): Promise<
  ApiResult<PaginatedResponse<Visit>>
> {
  return listVisits("pageSize=100");
}

export async function createVisit(
  locationId: string,
  representativeUserId: string,
  visitType: string,
): Promise<ApiResult<Visit>> {
  return apiPost<Visit>("/visits", {
    locationId,
    representativeUserId,
    visitType,
  });
}

export async function listLocations(): Promise<
  ApiResult<PaginatedResponse<Location>>
> {
  return apiGet<PaginatedResponse<Location>>(
    "/locations?pageSize=100&status=active",
  );
}

export async function listProducts(): Promise<
  ApiResult<PaginatedResponse<Product>>
> {
  return apiGet<PaginatedResponse<Product>>("/products?pageSize=100");
}

export async function listAdminLocations(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<Location>>> {
  return apiGet<PaginatedResponse<Location>>(`/locations?${query}`);
}

export async function updateAdminLocation(
  locationId: string,
  input: {
    name?: string;
    type?: string | null;
    city?: string;
    region?: string | null;
    territory?: string | null;
    status?: LocationStatus;
  },
): Promise<ApiResult<Location>> {
  return apiPatch<Location>(`/locations/${locationId}`, input);
}

export async function listAdminProducts(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<Product>>> {
  return apiGet<PaginatedResponse<Product>>(`/products?${query}`);
}

export async function updateAdminProduct(
  productId: string,
  input: {
    name?: string;
    sku?: string | null;
    category?: string | null;
    notApplicable?: boolean;
    status?: ProductStatus;
  },
): Promise<ApiResult<Product>> {
  return apiPatch<Product>(`/products/${productId}`, input);
}

export async function listTodayRoutes(): Promise<ApiResult<RoutePlan[]>> {
  return apiGet<RoutePlan[]>("/routes/today");
}

export async function listRoutes(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<RoutePlan>>> {
  return apiGet<PaginatedResponse<RoutePlan>>(`/routes?${query}`);
}

export async function listTasks(
  query = "pageSize=50",
): Promise<ApiResult<PaginatedResponse<Task>>> {
  return apiGet<PaginatedResponse<Task>>(`/tasks?${query}`);
}

export async function getAdminSettings(): Promise<ApiResult<TenantSettings>> {
  return apiGet<TenantSettings>("/admin/settings");
}

export async function updateAdminSettings(input: {
  name?: string;
  timezone?: string;
  productsEnabled?: boolean;
}): Promise<ApiResult<TenantSettings>> {
  return apiPatch<TenantSettings>("/admin/settings", input);
}

export async function listAdminUsers(): Promise<
  ApiResult<PaginatedResponse<TenantUser>>
> {
  return apiGet<PaginatedResponse<TenantUser>>("/admin/users?pageSize=100");
}

export async function inviteAdminUser(input: {
  email: string;
  roleCodes: TenantRoleCode[];
}): Promise<ApiResult<InviteUserResult>> {
  return apiPost<InviteUserResult>("/admin/users/invite", input);
}

export async function listAdminInvites(): Promise<
  ApiResult<InviteHistoryItem[]>
> {
  return apiGet<InviteHistoryItem[]>("/admin/users/invites");
}

export async function resendAdminInvite(
  inviteId: string,
): Promise<ApiResult<InviteUserResult>> {
  return apiPost<InviteUserResult>(
    `/admin/users/invites/${inviteId}/resend`,
    {},
  );
}

export async function updateAdminUser(
  userId: string,
  input: {
    name?: string;
    phone?: string | null;
    status?: TenantUserStatus;
  },
): Promise<ApiResult<TenantUser>> {
  return apiPatch<TenantUser>(`/admin/users/${userId}`, input);
}

export async function addAdminUserRole(
  userId: string,
  roleCode: TenantRoleCode,
): Promise<ApiResult<TenantUser>> {
  return apiPost<TenantUser>(`/admin/users/${userId}/roles`, { roleCode });
}

export async function removeAdminUserRole(
  userId: string,
  roleCode: TenantRoleCode,
): Promise<ApiResult<TenantUser>> {
  return apiDelete<TenantUser>(`/admin/users/${userId}/roles/${roleCode}`);
}

export async function createTask(input: {
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedToUserId?: string;
  locationId?: string;
  dueDate?: string;
}): Promise<ApiResult<Task>> {
  return apiPost<Task>("/tasks", input);
}

export async function updateTask(
  taskId: string,
  input: {
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
  },
): Promise<ApiResult<Task>> {
  return apiPatch<Task>(`/tasks/${taskId}`, input);
}

export async function listHighPriorityTasks(): Promise<
  ApiResult<PaginatedResponse<Task>>
> {
  return listTasks("pageSize=50&priority=high");
}

export async function listImportTemplates(): Promise<
  ApiResult<ImportTemplateSummary[]>
> {
  return apiGet<ImportTemplateSummary[]>("/imports/templates");
}

export async function validateCsvImport(
  templateType: string,
  csvText: string,
): Promise<ApiResult<StoredImportValidationPreview>> {
  return apiPost<StoredImportValidationPreview>("/imports/jobs/validate", {
    templateType,
    csvText,
  });
}

export async function getImportValidationJob(
  importJobId: string,
): Promise<ApiResult<StoredImportValidationPreview>> {
  return apiGet<StoredImportValidationPreview>(`/imports/jobs/${importJobId}`);
}

export async function listImportJobs(): Promise<
  ApiResult<ImportJobHistoryItem[]>
> {
  return apiGet<ImportJobHistoryItem[]>("/imports/jobs");
}

export async function confirmImportJob(
  importJobId: string,
): Promise<ApiResult<ImportApplyResult>> {
  return apiPost<ImportApplyResult>(`/imports/jobs/${importJobId}/confirm`, {});
}

export async function getOperationsSummary(): Promise<
  ApiResult<OperationsSummary>
> {
  return apiGet<OperationsSummary>("/operations/summary");
}

export async function confirmManualReport(
  visitId: string,
  confirmedData: Record<string, string>,
): Promise<ApiResult<Report>> {
  return apiPost<Report>(`/visits/${visitId}/reports/confirm`, {
    schemaVersion: "manual.v1",
    confirmedData,
  });
}

export async function addTextVisitNote(
  visitId: string,
  textContent: string,
): Promise<ApiResult<VisitNote>> {
  return apiPost<VisitNote>(`/visits/${visitId}/notes/text`, {
    textContent,
  });
}

export async function uploadAudioVisitNote(
  visitId: string,
  audioFile: File,
): Promise<ApiResult<RegisteredAudioUpload>> {
  const contentType = normalizeAudioContentType(audioFile);
  const registrationResult = await apiPost<RegisteredAudioUpload>(
    `/visits/${visitId}/notes/audio/register`,
    {
      fileName: audioFile.name || "voice-note.webm",
      contentType,
      sizeBytes: audioFile.size,
    },
  );

  if (!registrationResult.ok || !registrationResult.data.uploadUrl) {
    return registrationResult;
  }

  try {
    const uploadResponse = await fetch(registrationResult.data.uploadUrl.url, {
      method: registrationResult.data.uploadUrl.method,
      headers: registrationResult.data.uploadUrl.headers,
      body: audioFile,
    });

    if (!uploadResponse.ok) {
      return {
        ok: false,
        status: uploadResponse.status,
        message: `Audio upload failed with ${uploadResponse.status}.`,
      };
    }
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "Audio upload failed.",
    };
  }

  return registrationResult;
}

export function buildApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiGet<TData>(path: string): Promise<ApiResult<TData>> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: await buildRequestHeaders(),
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "API request failed.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await readErrorMessage(response),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

async function apiPost<TData>(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult<TData>> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        ...(await buildRequestHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "API request failed.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await readErrorMessage(response),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

async function apiPatch<TData>(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult<TData>> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      cache: "no-store",
      headers: {
        ...(await buildRequestHeaders()),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "API request failed.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await readErrorMessage(response),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

async function apiDelete<TData>(path: string): Promise<ApiResult<TData>> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "DELETE",
      cache: "no-store",
      headers: await buildRequestHeaders(),
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "API request failed.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: await readErrorMessage(response),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

export async function buildRequestHeaders(): Promise<HeadersInit> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieHeader = cookieStore.toString();
  const requestId = headerStore.get("x-request-id");
  const csrfToken = cookieStore.get("vizitum_csrf")?.value;

  return {
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(requestId ? { "x-request-id": requestId } : {}),
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `API request failed with ${response.status}.`;

  try {
    const payload = (await response.json()) as { message?: unknown };

    return typeof payload.message === "string" ? payload.message : fallback;
  } catch {
    return fallback;
  }
}

function getApiBaseUrl(): string {
  const rawBaseUrl =
    process.env.API_BASE_URL?.trim() || "http://127.0.0.1:4000/api";

  return rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
}

function normalizeAudioContentType(audioFile: File): string {
  const explicitType = audioFile.type.trim().toLowerCase();
  const extension = audioFile.name.split(".").pop()?.toLowerCase();
  const aliasedType = normalizeAudioContentTypeAlias(explicitType, extension);

  if (aliasedType) {
    return aliasedType;
  }

  if (extension === "mp3") {
    return "audio/mpeg";
  }

  if (extension === "m4a" || extension === "mp4" || extension === "aac") {
    return "audio/mp4";
  }

  if (extension === "wav") {
    return "audio/wav";
  }

  return "audio/webm";
}

function normalizeAudioContentTypeAlias(
  contentType: string,
  extension: string | undefined,
): string | null {
  if (
    contentType === "audio/mp4" ||
    contentType === "audio/mp4;codecs=mp4a.40.2" ||
    contentType === "audio/aac" ||
    contentType === "audio/mpeg" ||
    contentType === "audio/wav" ||
    contentType === "audio/webm" ||
    contentType === "audio/webm;codecs=opus"
  ) {
    return contentType;
  }

  if (contentType === "audio/mp3") {
    return "audio/mpeg";
  }

  if (contentType === "audio/wave" || contentType === "audio/x-wav") {
    return "audio/wav";
  }

  if (
    contentType === "audio/m4a" ||
    contentType === "audio/x-m4a" ||
    (contentType === "video/mp4" &&
      (extension === "m4a" || extension === "mp4" || extension === "aac"))
  ) {
    return "audio/mp4";
  }

  return null;
}
