export type ImportTemplateType =
  | "users"
  | "locations"
  | "contacts"
  | "products"
  | "initial_visit_task_plan";

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
