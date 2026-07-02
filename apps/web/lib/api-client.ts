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

export type ApiResult<TData> =
  { ok: true; data: TData } | { ok: false; status: number; message: string };

export async function getCurrentSession(): Promise<ApiResult<AuthSession>> {
  return apiGet<AuthSession>("/auth/me");
}

export async function listVisits(): Promise<
  ApiResult<PaginatedResponse<Visit>>
> {
  return apiGet<PaginatedResponse<Visit>>("/visits?pageSize=50");
}

export async function listTodayRoutes(): Promise<ApiResult<RoutePlan[]>> {
  return apiGet<RoutePlan[]>("/routes/today");
}

export async function listTasks(
  query = "pageSize=50",
): Promise<ApiResult<PaginatedResponse<Task>>> {
  return apiGet<PaginatedResponse<Task>>(`/tasks?${query}`);
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

async function buildRequestHeaders(): Promise<HeadersInit> {
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
