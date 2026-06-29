export type ImportTemplateType =
  "users" | "locations" | "contacts" | "products" | "initial_visit_task_plan";

export type ImportTemplateColumn = {
  key: string;
  required: boolean;
  description: string;
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
};

export type StoredImportValidationPreview = ImportValidationPreview & {
  importJobId: string;
  status: "validated" | "validation_failed";
};
