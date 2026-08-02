import type { TextLimitKey } from "../../common/input-limits";

export type ImportTemplateType =
  "users" | "locations" | "contacts" | "products" | "initial_visit_task_plan";

export type ImportTemplateColumn = {
  key: string;
  required: boolean;
  description: string;
  // Backend length cap for this cell, from the shared TEXT_LIMITS map.
  //
  // The manual endpoints cap the same fields through their `normalize*`
  // helpers; the import path writes the same columns and did not, so a
  // scripted caller could post a location whose name is bounded only by the
  // 100 kB body limit. Declaring the cap on the column keeps one generic
  // validation pass honest for every template.
  //
  // Omitted for cells whose own parser already bounds them — a date, a time,
  // a coordinate or a sequence number is rejected long before length matters.
  limit?: TextLimitKey;
};

export type ImportTemplateDefinition = {
  type: ImportTemplateType;
  label: string;
  fileName: string;
  columns: ImportTemplateColumn[];
  validations: string[];
};

export type ImportTemplateSummary = {
  type: ImportTemplateType;
  label: string;
  fileName: string;
  downloadPath: string;
  requiredColumns: string[];
  optionalColumns: string[];
};

export type ImportTemplateDownload = {
  fileName: string;
  contentType: string;
  body: string;
};

export type ParsedImportRow = Record<string, string>;

export type ParsedImportFile = {
  templateType: ImportTemplateType;
  columns: string[];
  rows: ParsedImportRow[];
};

export type ImportPreviewIssueSeverity = "error" | "warning";

export type ImportPreviewIssue = {
  rowNumber: number;
  fieldName?: string;
  severity: ImportPreviewIssueSeverity;
  code: string;
  message: string;
  rawValue?: string;
};

export type ImportValidationPreview = {
  templateType: ImportTemplateType;
  rowCount: number;
  validRowCount: number;
  errorRowCount: number;
  warningRowCount: number;
  canConfirm: boolean;
  issues: ImportPreviewIssue[];
};

export type CreateImportValidationJobOptions = {
  sourceFileObjectId?: string;
  sourceFileName?: string;
};

export type CreateImportValidationJobRequestBody = {
  templateType?: unknown;
  csvText?: unknown;
  fileName?: unknown;
};

export type StoredImportValidationPreview = ImportValidationPreview & {
  importJobId: string;
  status: "validated" | "validation_failed";
  validatedAt: string | null;
  sourceFileName: string | null;
};

export type ImportJobHistoryItem = {
  id: string;
  templateType: ImportTemplateType;
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
    name: string;
    email: string;
  };
  confirmedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdCounts: ImportApplyResult["createdCounts"] | null;
  createdAt: Date;
  validatedAt: Date | null;
  confirmedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
};

export type ImportApplyResult = {
  importJobId: string;
  status: "applied";
  appliedRowCount: number;
  createdCounts: {
    users: number;
    userRoles: number;
    chains: number;
    locationCategories: number;
    locations: number;
    locationAssignments: number;
    contacts: number;
    products: number;
    routePlans: number;
    routeItems: number;
    tasks: number;
  };
};
