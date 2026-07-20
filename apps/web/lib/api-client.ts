import { cookies, headers } from "next/headers";

export type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    lastSelectedRoleCode: string | null;
    lastSelectedZone: string | null;
  };
  roleCodes: string[];
  permissions: string[];
  productsEnabled: boolean;
  locationCategoriesEnabled: boolean;
  tenantTimezone: string;
  // Tenant is still on the pilot plan (status "pilot"); gates the temporary
  // "Pilot" admin nav area.
  pilotActive: boolean;
};

export type VisitStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type RouteStatus =
  "draft" | "published" | "in_progress" | "completed" | "cancelled";
export type RouteItemStatus = "planned" | "visited" | "skipped";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";
export type TenantRoleCode =
  | "tenant_superadmin"
  | "company_admin"
  | "team_manager"
  | "field_representative";
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

export type ChainStatus = "active" | "archived";

export type ChainSummary = {
  id: string;
  name: string;
};

export type LocationCategorySummary = {
  id: string;
  name: string;
};

export type Chain = {
  id: string;
  externalCode: string | null;
  name: string;
  status: ChainStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationContact = {
  id: string;
  locationId: string;
  name: string;
  roleTitle: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationAssignment = {
  id: string;
  locationId: string;
  representativeUserId: string;
  representative: {
    id: string;
    email: string;
    name: string;
  };
  status: "active" | "inactive";
  assignedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Location = {
  id: string;
  externalCode: string | null;
  name: string;
  status: LocationStatus;
  archived: boolean;
  chainId: string | null;
  chain: ChainSummary | null;
  categoryId: string | null;
  category: LocationCategorySummary | null;
  addressLine: string;
  city: string;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  contacts: LocationContact[];
  assignments: LocationAssignment[];
  createdAt: string;
  updatedAt: string;
};

export type LocationCategory = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type LocationPotential = {
  id: string;
  locationId: string;
  productCategoryId: string;
  productCategory: { id: string; name: string };
  potentialDate: string | null;
  potentialAmount: number | null;
  planMonth1: number | null;
  planMonth2: number | null;
  planMonth3: number | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationPotentialList = {
  items: LocationPotential[];
  canManage: boolean;
};

export type AssortmentStatus =
  "in_stock" | "out_of_stock" | "to_order" | "not_relevant";

export type LocationAssortment = {
  id: string;
  locationId: string;
  productId: string;
  product: {
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    status: ProductStatus;
  };
  shouldBeListed: boolean;
  status: AssortmentStatus;
  lastStock: number | null;
  lastOrder: number | null;
  lastSale: number | null;
  lastCheckedAt: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LocationAssortmentList = {
  items: LocationAssortment[];
  canManage: boolean;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
};

export type LocationInsightsLocationSummary = {
  locationId: string;
  name: string;
  totalPotential: number;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
};

export type LocationInsightsProblemProduct = {
  productId: string;
  name: string;
  sku: string | null;
  problemCount: number;
};

export type LocationInsightsCategoryPotential = {
  productCategoryId: string;
  name: string;
  totalPotential: number;
  planMonth1: number;
  planMonth2: number;
  planMonth3: number;
};

export type LocationInsightsSummary = {
  totalPotential: number;
  planMonth1: number;
  planMonth2: number;
  planMonth3: number;
  overallCoveragePct: number;
  requiredCount: number;
  inStockCount: number;
  locations: LocationInsightsLocationSummary[];
  highPotentialLowCoverage: LocationInsightsLocationSummary[];
  topProblemProducts: LocationInsightsProblemProduct[];
  potentialByCategory: LocationInsightsCategoryPotential[];
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

export type ProductCategory = {
  id: string;
  name: string;
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
  routeTemplateId: string | null;
  routeTemplate: { id: string; name: string } | null;
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

export type RouteTemplate = {
  id: string;
  representativeUserId: string;
  name: string;
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
  location: {
    id: string;
    name: string;
    addressLine: string;
    city: string;
  } | null;
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

export type TenantLogo = {
  storageObjectId: string;
  contentType: string;
  url: string;
  urlExpiresAt: string;
};

export type TenantSettings = {
  tenantId: string;
  name: string;
  timezone: string;
  language: string;
  productMode: string;
  productsEnabled: boolean;
  locationCategoriesEnabled: boolean;
  colorScheme: string;
  logo: TenantLogo | null;
  updatedAt: string;
};

export type RegisteredLogoUpload = {
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

export type PilotReviewThresholdStatus = "met" | "not_met" | "na";

export type PilotReviewThreshold = {
  key: string;
  label: string;
  target: string;
  result: string;
  status: PilotReviewThresholdStatus;
};

export type PilotReviewSummary = {
  firstVisitAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  hasInitialPlan: boolean;
  thresholds: PilotReviewThreshold[];
  generatedAt: string;
};

export type DashboardViewPage = "manager" | "admin_review";

export type InviteUserInput = {
  email: string;
  roleCodes: TenantRoleCode[];
};

// Delivery outcome of the invite email; `skipped` means sending is disabled
// for the environment and the link must be shared manually.
export type InviteEmailStatus = "skipped" | "sent" | "failed";

export type InviteUserResult = {
  id: string;
  email: string;
  roleCodes: TenantRoleCode[];
  status: string;
  emailStatus: InviteEmailStatus;
  expiresAt: string;
  token: string;
};

export type InviteHistoryItem = {
  id: string;
  email: string;
  roleCodes: TenantRoleCode[];
  status: "pending" | "accepted" | "expired" | "revoked";
  emailStatus: InviteEmailStatus;
  emailSentAt: string | null;
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
  validatedAt: string | null;
  sourceFileName: string | null;
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

export type ReportCreatedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignedToUserId: string | null;
  dueDate: string | null;
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
  createdTaskCount: number;
  createdTasks: ReportCreatedTask[];
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

// `code`/`details` mirror the backend's ApiErrorResponse (src/common/api-error.types.ts)
// when the failure came back as JSON with those fields — absent for network
// failures or bodies that don't carry them, so callers that only had `status`/
// `message` before keep working unchanged.
export type ApiResult<TData> =
  | { ok: true; data: TData }
  | {
      ok: false;
      status: number;
      message: string;
      code?: string;
      details?: unknown;
    };

export async function getCurrentSession(): Promise<ApiResult<AuthSession>> {
  return apiGet<AuthSession>("/auth/me");
}

// POST /auth/zone returns the same shape POST /auth/role does — user,
// roleCodes and permissions, without the productsEnabled/tenantTimezone
// extras that only GET /auth/me adds.
export type SwitchZoneResult = Pick<
  AuthSession,
  "user" | "roleCodes" | "permissions"
>;

export async function switchZone(
  zone: string,
): Promise<ApiResult<SwitchZoneResult>> {
  return apiPost<SwitchZoneResult>("/auth/zone", { zone });
}

export async function listVisits(
  query = "pageSize=50",
): Promise<ApiResult<PaginatedResponse<Visit>>> {
  return apiGet<PaginatedResponse<Visit>>(`/visits?${query}`);
}

export async function getVisit(visitId: string): Promise<ApiResult<Visit>> {
  return apiGet<Visit>(`/visits/${visitId}`);
}

export async function getVisitReport(
  visitId: string,
): Promise<ApiResult<Report>> {
  return apiGet<Report>(`/visits/${visitId}/report`);
}

export async function createVisit(
  locationId: string,
  representativeUserId: string,
  visitType: string,
  routeItemId?: string,
): Promise<ApiResult<Visit>> {
  return apiPost<Visit>("/visits", {
    locationId,
    representativeUserId,
    visitType,
    ...(routeItemId ? { routeItemId } : {}),
  });
}

export async function listLocations(): Promise<
  ApiResult<PaginatedResponse<Location>>
> {
  return apiGet<PaginatedResponse<Location>>(
    "/locations?pageSize=100&status=active",
  );
}

export async function getLocation(
  locationId: string,
): Promise<ApiResult<Location>> {
  return apiGet<Location>(`/locations/${locationId}`);
}

export async function listLocationPotential(
  locationId: string,
): Promise<ApiResult<LocationPotentialList>> {
  return apiGet<LocationPotentialList>(`/locations/${locationId}/potential`);
}

export async function upsertLocationPotential(
  locationId: string,
  productCategoryId: string,
  input: {
    potentialDate?: string | null;
    potentialAmount?: number | null;
    planMonth1?: number | null;
    planMonth2?: number | null;
    planMonth3?: number | null;
    comment?: string | null;
  },
): Promise<ApiResult<LocationPotential>> {
  return apiPut<LocationPotential>(
    `/locations/${locationId}/potential/${productCategoryId}`,
    input,
  );
}

export async function deleteLocationPotential(
  locationId: string,
  productCategoryId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(
    `/locations/${locationId}/potential/${productCategoryId}`,
  );
}

export async function listLocationAssortment(
  locationId: string,
): Promise<ApiResult<LocationAssortmentList>> {
  return apiGet<LocationAssortmentList>(`/locations/${locationId}/assortment`);
}

export async function upsertLocationAssortment(
  locationId: string,
  productId: string,
  input: {
    shouldBeListed?: boolean;
    status?: AssortmentStatus;
    lastStock?: number | null;
    lastOrder?: number | null;
    lastSale?: number | null;
    lastCheckedAt?: string | null;
    comment?: string | null;
  },
): Promise<ApiResult<LocationAssortment>> {
  return apiPut<LocationAssortment>(
    `/locations/${locationId}/assortment/${productId}`,
    input,
  );
}

export async function deleteLocationAssortment(
  locationId: string,
  productId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(
    `/locations/${locationId}/assortment/${productId}`,
  );
}

export async function getLocationInsightsSummary(): Promise<
  ApiResult<LocationInsightsSummary>
> {
  return apiGet<LocationInsightsSummary>("/location-insights/summary");
}

export async function listProducts(): Promise<
  ApiResult<PaginatedResponse<Product>>
> {
  return apiGet<PaginatedResponse<Product>>("/products?pageSize=100");
}

// Cheap active-product count for the launch checklist: the paginated `total`
// reflects the full filtered count server-side (prisma.product.count over the
// same `status=active` where clause), so we don't have to page through or count
// items on a single page — which would undercount tenants with >100 products.
export async function countActiveProducts(): Promise<ApiResult<number>> {
  const result = await apiGet<PaginatedResponse<Product>>(
    "/products?status=active&pageSize=1",
  );

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: result.data.total };
}

export async function listAdminLocations(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<Location>>> {
  return apiGet<PaginatedResponse<Location>>(`/locations?${query}`);
}

export async function createAdminLocation(input: {
  name: string;
  addressLine: string;
  city: string;
  externalCode?: string | null;
  categoryId?: string | null;
  chainId?: string | null;
  notes?: string | null;
}): Promise<ApiResult<Location>> {
  return apiPost<Location>("/locations", input);
}

export async function updateAdminLocation(
  locationId: string,
  input: {
    name?: string;
    externalCode?: string | null;
    categoryId?: string | null;
    chainId?: string | null;
    addressLine?: string;
    city?: string;
    territory?: string | null;
    notes?: string | null;
    status?: LocationStatus;
  },
): Promise<ApiResult<Location>> {
  return apiPatch<Location>(`/locations/${locationId}`, input);
}

export async function archiveAdminLocation(
  locationId: string,
): Promise<ApiResult<Location>> {
  return apiDelete<Location>(`/locations/${locationId}`);
}

export async function restoreAdminLocation(
  locationId: string,
): Promise<ApiResult<Location>> {
  return apiPost<Location>(`/locations/${locationId}/restore`, {});
}

export async function createAdminLocationContact(
  locationId: string,
  input: { name: string; phone?: string | null },
): Promise<ApiResult<LocationContact>> {
  return apiPost<LocationContact>(`/locations/${locationId}/contacts`, input);
}

export async function updateAdminLocationContact(
  locationId: string,
  contactId: string,
  input: { name?: string; phone?: string | null },
): Promise<ApiResult<LocationContact>> {
  return apiPatch<LocationContact>(
    `/locations/${locationId}/contacts/${contactId}`,
    input,
  );
}

export async function deleteAdminLocationContact(
  locationId: string,
  contactId: string,
): Promise<ApiResult<{ ok: true }>> {
  return apiDelete<{ ok: true }>(
    `/locations/${locationId}/contacts/${contactId}`,
  );
}

export async function createAdminLocationAssignment(
  locationId: string,
  representativeUserId: string,
): Promise<ApiResult<LocationAssignment>> {
  return apiPost<LocationAssignment>(`/locations/${locationId}/assignments`, {
    representativeUserId,
  });
}

export async function deactivateAdminLocationAssignment(
  locationId: string,
  assignmentId: string,
): Promise<ApiResult<LocationAssignment>> {
  return apiPatch<LocationAssignment>(
    `/locations/${locationId}/assignments/${assignmentId}/deactivate`,
    {},
  );
}

export async function listLocationCategories(): Promise<
  ApiResult<LocationCategory[]>
> {
  return apiGet<LocationCategory[]>("/location-categories");
}

export async function createLocationCategory(input: {
  name: string;
}): Promise<ApiResult<LocationCategory>> {
  return apiPost<LocationCategory>("/location-categories", input);
}

export async function updateLocationCategory(
  categoryId: string,
  input: { name: string },
): Promise<ApiResult<LocationCategory>> {
  return apiPatch<LocationCategory>(
    `/location-categories/${categoryId}`,
    input,
  );
}

export async function deleteLocationCategory(
  categoryId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/location-categories/${categoryId}`);
}

export async function listAdminChains(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<Chain>>> {
  return apiGet<PaginatedResponse<Chain>>(`/chains?${query}`);
}

export async function createAdminChain(input: {
  name: string;
  externalCode?: string | null;
  notes?: string | null;
}): Promise<ApiResult<Chain>> {
  return apiPost<Chain>("/chains", input);
}

export async function updateAdminChain(
  chainId: string,
  input: {
    name?: string;
    externalCode?: string | null;
    notes?: string | null;
    status?: ChainStatus;
  },
): Promise<ApiResult<Chain>> {
  return apiPatch<Chain>(`/chains/${chainId}`, input);
}

export async function listAdminProducts(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<Product>>> {
  return apiGet<PaginatedResponse<Product>>(`/products?${query}`);
}

export async function createAdminProduct(input: {
  name: string;
  sku?: string | null;
  category?: string | null;
  notApplicable?: boolean;
}): Promise<ApiResult<Product>> {
  return apiPost<Product>("/products", input);
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

export async function deleteAdminProduct(
  productId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/products/${productId}`);
}

export async function listProductCategories(): Promise<
  ApiResult<ProductCategory[]>
> {
  return apiGet<ProductCategory[]>("/product-categories");
}

export async function createProductCategory(input: {
  name: string;
}): Promise<ApiResult<ProductCategory>> {
  return apiPost<ProductCategory>("/product-categories", input);
}

export async function updateProductCategory(
  categoryId: string,
  input: { name: string },
): Promise<ApiResult<ProductCategory>> {
  return apiPatch<ProductCategory>(`/product-categories/${categoryId}`, input);
}

export async function deleteProductCategory(
  categoryId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/product-categories/${categoryId}`);
}

export async function listTodayRoutes(): Promise<ApiResult<RoutePlan[]>> {
  return apiGet<RoutePlan[]>("/routes/today");
}

export async function listRoutes(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<RoutePlan>>> {
  return apiGet<PaginatedResponse<RoutePlan>>(`/routes?${query}`);
}

export async function createRoutePlan(input: {
  representativeUserId: string;
  planDate: string;
}): Promise<ApiResult<RoutePlan>> {
  return apiPost<RoutePlan>("/routes", input);
}

export async function deleteRoutePlan(
  routePlanId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/routes/${routePlanId}`);
}

export async function addRouteItem(
  routePlanId: string,
  input: { locationId: string; sequence: number },
): Promise<ApiResult<RoutePlan>> {
  return apiPost<RoutePlan>(`/routes/${routePlanId}/items`, input);
}

export async function updateRouteItem(
  routePlanId: string,
  routeItemId: string,
  input: { status?: RouteItemStatus; sequence?: number },
): Promise<ApiResult<RoutePlan>> {
  return apiPatch<RoutePlan>(
    `/routes/${routePlanId}/items/${routeItemId}`,
    input,
  );
}

export async function listRouteTemplates(
  query = "pageSize=100",
): Promise<ApiResult<PaginatedResponse<RouteTemplate>>> {
  return apiGet<PaginatedResponse<RouteTemplate>>(
    `/routes/templates${query ? `?${query}` : ""}`,
  );
}

export async function getRouteTemplate(
  templateId: string,
): Promise<ApiResult<RouteTemplate>> {
  return apiGet<RouteTemplate>(`/routes/templates/${templateId}`);
}

export async function createRouteTemplate(input: {
  representativeUserId: string;
  name: string;
}): Promise<ApiResult<RouteTemplate>> {
  return apiPost<RouteTemplate>("/routes/templates", input);
}

export async function updateRouteTemplate(
  templateId: string,
  input: { name: string },
): Promise<ApiResult<RouteTemplate>> {
  return apiPatch<RouteTemplate>(`/routes/templates/${templateId}`, input);
}

export async function deleteRouteTemplate(
  templateId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/routes/templates/${templateId}`);
}

export async function addRouteTemplateItem(
  templateId: string,
  input: { locationId: string; sequence: number },
): Promise<ApiResult<RouteTemplate>> {
  return apiPost<RouteTemplate>(`/routes/templates/${templateId}/items`, input);
}

export async function updateRouteTemplateItem(
  templateId: string,
  itemId: string,
  input: { locationId?: string; sequence?: number },
): Promise<ApiResult<RouteTemplate>> {
  return apiPatch<RouteTemplate>(
    `/routes/templates/${templateId}/items/${itemId}`,
    input,
  );
}

export async function reorderRouteTemplateItems(
  templateId: string,
  itemIds: string[],
): Promise<ApiResult<RouteTemplate>> {
  return apiPost<RouteTemplate>(
    `/routes/templates/${templateId}/items/reorder`,
    { itemIds },
  );
}

export async function deleteRouteTemplateItem(
  templateId: string,
  itemId: string,
): Promise<ApiResult<RouteTemplate>> {
  return apiDelete<RouteTemplate>(
    `/routes/templates/${templateId}/items/${itemId}`,
  );
}

export async function assignRouteTemplate(
  templateId: string,
  input: { planDate: string },
): Promise<ApiResult<RoutePlan>> {
  return apiPost<RoutePlan>(`/routes/templates/${templateId}/assign`, input);
}

export async function copyRoutePlansFromLastMonth(input: {
  month: string;
}): Promise<ApiResult<{ createdCount: number; skippedCount: number }>> {
  return apiPost<{ createdCount: number; skippedCount: number }>(
    "/routes/templates/copy-month",
    input,
  );
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
  language?: string;
  productsEnabled?: boolean;
  locationCategoriesEnabled?: boolean;
  colorScheme?: string;
}): Promise<ApiResult<TenantSettings>> {
  return apiPatch<TenantSettings>("/admin/settings", input);
}

export async function deleteTenantLogo(): Promise<ApiResult<TenantSettings>> {
  return apiDelete<TenantSettings>("/admin/settings/logo");
}

// Register -> presigned PUT -> confirm, mirroring uploadAudioVisitNote: the
// API never sees the bytes, they go straight to object storage.
export async function uploadTenantLogo(
  logoFile: File,
): Promise<ApiResult<TenantSettings>> {
  const registrationResult = await apiPost<RegisteredLogoUpload>(
    "/admin/settings/logo/register",
    {
      fileName: logoFile.name || "logo.png",
      contentType: logoFile.type || undefined,
      sizeBytes: logoFile.size,
    },
  );

  if (!registrationResult.ok) {
    return registrationResult;
  }

  if (!registrationResult.data.uploadUrl) {
    return {
      ok: false,
      status: 0,
      message: "Logo upload is not available.",
    };
  }

  try {
    const uploadResponse = await fetch(registrationResult.data.uploadUrl.url, {
      method: registrationResult.data.uploadUrl.method,
      headers: registrationResult.data.uploadUrl.headers,
      body: logoFile,
    });

    if (!uploadResponse.ok) {
      return {
        ok: false,
        status: uploadResponse.status,
        message: `Logo upload failed with ${uploadResponse.status}.`,
      };
    }
  } catch (error: unknown) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : "Logo upload failed.",
    };
  }

  return apiPost<TenantSettings>("/admin/settings/logo/confirm", {
    storageObjectId: registrationResult.data.storageObject.id,
  });
}

export async function getPilotReviewSummary(): Promise<
  ApiResult<PilotReviewSummary>
> {
  return apiGet<PilotReviewSummary>("/pilot-review/summary");
}

export async function recordDashboardView(
  page: DashboardViewPage,
): Promise<ApiResult<{ recorded: true }>> {
  return apiPost<{ recorded: true }>("/pilot-review/dashboard-views", {
    page,
  });
}

export type AdminUsersListResponse = PaginatedResponse<TenantUser> & {
  adminLimit: number;
  activeAdminCount: number;
};

export async function listAdminUsers(): Promise<
  ApiResult<AdminUsersListResponse>
> {
  return apiGet<AdminUsersListResponse>("/admin/users?pageSize=100");
}

export async function inviteAdminUser(
  input: InviteUserInput,
): Promise<ApiResult<InviteUserResult>> {
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

export async function deleteAdminUser(
  userId: string,
): Promise<ApiResult<{ id: string; status: "deleted" }>> {
  return apiDelete<{ id: string; status: "deleted" }>(`/admin/users/${userId}`);
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
    description?: string | null;
  },
): Promise<ApiResult<Task>> {
  return apiPatch<Task>(`/tasks/${taskId}`, input);
}

export async function deleteTask(
  taskId: string,
): Promise<ApiResult<{ deleted: true }>> {
  return apiDelete<{ deleted: true }>(`/tasks/${taskId}`);
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
  fileName?: string,
): Promise<ApiResult<StoredImportValidationPreview>> {
  return apiPost<StoredImportValidationPreview>("/imports/jobs/validate", {
    templateType,
    csvText,
    fileName,
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

export type PlatformSegmentTemplate =
  "distribution" | "service" | "partner_account";

export type PlatformTenantMetrics = {
  companyAdminCount: number;
  teamManagerCount: number;
  fieldRepresentativeCount: number;
  visitCount: number;
  productCount: number;
  locationCount: number;
};

export type PlatformTenant = {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  language: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  productMode: string;
  // Whether the tenant tracks products/SKUs (gates the admin "Products" area).
  // Owner-controlled; populated by the tenant list, not the update response.
  productsEnabled?: boolean;
  segmentTemplate: PlatformSegmentTemplate;
  primaryDomain: string | null;
  // Effective Company Admin cap (owner override if set, otherwise plan-derived).
  adminLimit: number;
  // The raw owner override: null means the cap follows the plan tier.
  adminLimitOverride: number | null;
  // The cap the plan tier alone implies, regardless of any override.
  adminLimitPlanDefault: number;
  archivedAt: string | null;
  purgeRequestedAt: string | null;
  purgeStartedAt: string | null;
  // Backend-computed: when the purge worker may delete this archived tenant
  // on retention alone (archivedAt + retention window). Null unless archived.
  purgeEligibleAt?: string | null;
  createdAt: string;
  metrics?: PlatformTenantMetrics;
  superadmin?: TenantSuperadminSummary | null;
};

export type CreatePlatformTenantInput = {
  name: string;
  slug: string;
  segmentTemplate: PlatformSegmentTemplate;
  country?: string;
  timezone?: string;
  language?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryDomain?: string;
};

export type PlatformSession = {
  platformUser: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
  roleCodes: string[];
  permissions: string[];
};

export async function platformLogin(input: {
  email: string;
  password: string;
}): Promise<ApiResult<PlatformSession>> {
  return apiPost<PlatformSession>("/platform/auth/login", input);
}

export async function getPlatformSession(): Promise<
  ApiResult<PlatformSession>
> {
  return apiGet<PlatformSession>("/platform/auth/me");
}

export async function platformLogout(): Promise<ApiResult<{ ok: true }>> {
  return apiPost<{ ok: true }>("/platform/auth/logout", {});
}

export async function listPlatformTenants(): Promise<
  ApiResult<PlatformTenant[]>
> {
  return apiGet<PlatformTenant[]>("/platform/tenants");
}

export async function createPlatformTenant(
  input: CreatePlatformTenantInput,
): Promise<ApiResult<{ tenant: PlatformTenant }>> {
  return apiPost<{ tenant: PlatformTenant }>("/platform/tenants", input);
}

export type UpdatePlatformTenantInput = {
  name?: string;
  country?: string;
  timezone?: string;
  language?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  primaryDomain?: string | null;
  status?: string;
  // A positive integer sets a per-tenant override; null clears it so the cap
  // follows the plan tier.
  adminLimit?: number | null;
  // Toggles the tenant's product/SKU tracking (owner-only).
  productsEnabled?: boolean;
};

export async function updatePlatformTenant(
  tenantId: string,
  input: UpdatePlatformTenantInput,
): Promise<ApiResult<PlatformTenant>> {
  return apiPatch<PlatformTenant>(`/platform/tenants/${tenantId}`, input);
}

export async function archivePlatformTenant(
  tenantId: string,
): Promise<ApiResult<PlatformTenant>> {
  return apiPost<PlatformTenant>(`/platform/tenants/${tenantId}/archive`, {});
}

export async function unarchivePlatformTenant(
  tenantId: string,
): Promise<ApiResult<PlatformTenant>> {
  return apiPost<PlatformTenant>(`/platform/tenants/${tenantId}/unarchive`, {});
}

export async function requestPlatformTenantPurge(
  tenantId: string,
  input: { confirmSlug: string },
): Promise<ApiResult<PlatformTenant>> {
  return apiPost<PlatformTenant>(`/platform/tenants/${tenantId}/purge`, input);
}

export async function listPlatformTenantUsers(
  tenantId: string,
): Promise<ApiResult<PaginatedResponse<TenantUser>>> {
  return apiGet<PaginatedResponse<TenantUser>>(
    `/platform/tenants/${tenantId}/users`,
  );
}

export type TenantSuperadminSummary = {
  activeSuperadmin: TenantUser | null;
  pendingInvite: InviteHistoryItem | null;
};

export async function getPlatformTenantSuperadmin(
  tenantId: string,
): Promise<ApiResult<TenantSuperadminSummary>> {
  return apiGet<TenantSuperadminSummary>(
    `/platform/tenants/${tenantId}/superadmin`,
  );
}

export async function invitePlatformTenantSuperadmin(
  tenantId: string,
  input: { email: string },
): Promise<ApiResult<InviteUserResult>> {
  return apiPost<InviteUserResult>(
    `/platform/tenants/${tenantId}/superadmin/invite`,
    { email: input.email },
  );
}

export async function promotePlatformTenantSuperadmin(
  tenantId: string,
  input: { userId: string },
): Promise<ApiResult<TenantUser>> {
  return apiPost<TenantUser>(
    `/platform/tenants/${tenantId}/superadmin/promote`,
    { userId: input.userId },
  );
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
      headers: await buildRequestHeaders(path),
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
      ...(await readErrorPayload(response)),
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
        ...(await buildRequestHeaders(path)),
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
      ...(await readErrorPayload(response)),
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
        ...(await buildRequestHeaders(path)),
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
      ...(await readErrorPayload(response)),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

async function apiPut<TData>(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult<TData>> {
  const baseUrl = getApiBaseUrl();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "PUT",
      cache: "no-store",
      headers: {
        ...(await buildRequestHeaders(path)),
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
      ...(await readErrorPayload(response)),
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
      headers: await buildRequestHeaders(path),
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
      ...(await readErrorPayload(response)),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as TData,
  };
}

// Platform and tenant auth each have their own CSRF cookie (the backend
// namespaces them the same way, see src/modules/auth/csrf.ts) so that
// authenticating into one domain can't invalidate the other's still-valid
// session. Pick the cookie that matches which domain `path` targets.
const TENANT_CSRF_COOKIE_NAME = "vizitum_csrf";
export const PLATFORM_CSRF_COOKIE_NAME = "vizitum_platform_csrf";
// Exported alongside the CSRF cookie name so callers that must clear the
// platform session directly (logout — which can't trust a CSRF-rejected or
// network-failed response to have cleared anything) don't have to duplicate
// this literal from src/modules/platform/platform-auth.constants.ts.
export const PLATFORM_SESSION_COOKIE_NAME = "vizitum_platform_session";

function isPlatformApiPath(path: string): boolean {
  return path === "/platform" || path.startsWith("/platform/");
}

export async function buildRequestHeaders(path: string): Promise<HeadersInit> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieHeader = cookieStore.toString();
  const requestId = headerStore.get("x-request-id");
  const csrfCookieName = isPlatformApiPath(path)
    ? PLATFORM_CSRF_COOKIE_NAME
    : TENANT_CSRF_COOKIE_NAME;
  const csrfToken = cookieStore.get(csrfCookieName)?.value;

  return {
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...(requestId ? { "x-request-id": requestId } : {}),
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  };
}

async function readErrorPayload(
  response: Response,
): Promise<{ message: string; code?: string; details?: unknown }> {
  const fallback = `API request failed with ${response.status}.`;

  try {
    const payload = (await response.json()) as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };

    return {
      message: typeof payload.message === "string" ? payload.message : fallback,
      ...(typeof payload.code === "string" ? { code: payload.code } : {}),
      ...(payload.details !== undefined ? { details: payload.details } : {}),
    };
  } catch {
    return { message: fallback };
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
