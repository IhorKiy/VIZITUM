import { BadRequestException, Injectable } from "@nestjs/common";

import type {
  ImportTemplateDefinition,
  ImportTemplateDownload,
  ImportTemplateSummary,
  ImportTemplateType,
} from "./imports.types";

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

const IMPORT_TEMPLATES: readonly ImportTemplateDefinition[] = [
  {
    type: "users",
    label: "Users",
    fileName: "vizitum-users-template.csv",
    columns: [
      {
        key: "email",
        required: true,
        description: "User email, unique within the tenant.",
      },
      { key: "name", required: true, description: "Full user name." },
      {
        key: "roles",
        required: true,
        description: "Comma-separated role codes allowed for this tenant.",
      },
      { key: "phone", required: false, description: "Optional phone number." },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system user identifier.",
      },
    ],
    validations: [
      "email must be valid and unique within tenant",
      "roles must be allowed tenant roles",
      "duplicate emails in file are blocking",
    ],
  },
  {
    type: "locations",
    label: "Locations",
    fileName: "vizitum-locations-template.csv",
    columns: [
      { key: "name", required: true, description: "Location name." },
      {
        key: "address_line",
        required: true,
        description: "Street address or address line.",
      },
      { key: "city", required: true, description: "Location city." },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system location identifier.",
      },
      { key: "type", required: false, description: "Optional location type." },
      { key: "region", required: false, description: "Optional region." },
      {
        key: "territory",
        required: false,
        description: "Optional sales or service territory.",
      },
      {
        key: "latitude",
        required: false,
        description: "Optional decimal latitude.",
      },
      {
        key: "longitude",
        required: false,
        description: "Optional decimal longitude.",
      },
      {
        key: "assigned_representative_email",
        required: false,
        description: "Optional assigned field representative email.",
      },
      { key: "notes", required: false, description: "Optional notes." },
    ],
    validations: [
      "name and city are required",
      "external_code must be unique if provided",
      "assigned representative must resolve in tenant or import plan",
      "duplicate name/address is a warning",
    ],
  },
  {
    type: "contacts",
    label: "Contacts",
    fileName: "vizitum-contacts-template.csv",
    columns: [
      {
        key: "location_external_code",
        required: false,
        description: "Preferred location reference.",
      },
      {
        key: "location_name",
        required: false,
        description: "Fallback location reference when external code is absent.",
      },
      { key: "name", required: true, description: "Contact full name." },
      {
        key: "role_title",
        required: false,
        description: "Contact role or title.",
      },
      { key: "phone", required: false, description: "Optional phone number." },
      { key: "email", required: false, description: "Optional email address." },
      { key: "notes", required: false, description: "Optional notes." },
    ],
    validations: [
      "location_external_code or location_name is required",
      "location reference must resolve to exactly one location",
      "email must be valid if provided",
    ],
  },
  {
    type: "products",
    label: "Products",
    fileName: "vizitum-products-template.csv",
    columns: [
      { key: "name", required: true, description: "Product name." },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system product identifier.",
      },
      { key: "sku", required: false, description: "Optional SKU." },
      {
        key: "category",
        required: false,
        description: "Optional product category.",
      },
    ],
    validations: [
      "name is required",
      "external_code must be unique if provided",
      "product imports can be disabled by tenant settings",
    ],
  },
  {
    type: "initial_visit_task_plan",
    label: "Initial visit and task plan",
    fileName: "vizitum-initial-visit-task-plan-template.csv",
    columns: [
      {
        key: "representative_email",
        required: true,
        description: "Assigned field representative email.",
      },
      {
        key: "location_external_code",
        required: false,
        description: "Preferred location reference.",
      },
      {
        key: "location_name",
        required: false,
        description: "Fallback location reference when external code is absent.",
      },
      {
        key: "plan_date",
        required: true,
        description: "Planned visit date in YYYY-MM-DD format.",
      },
      {
        key: "sequence",
        required: false,
        description: "Optional daily route sequence number.",
      },
      {
        key: "planned_start_time",
        required: false,
        description: "Optional planned start time in HH:mm format.",
      },
      {
        key: "planned_end_time",
        required: false,
        description: "Optional planned end time in HH:mm format.",
      },
      {
        key: "task_title",
        required: false,
        description: "Optional task title to create with the plan.",
      },
      {
        key: "task_due_date",
        required: false,
        description: "Optional task due date in YYYY-MM-DD format.",
      },
      {
        key: "task_priority",
        required: false,
        description: "Optional task priority: low, normal or high.",
      },
    ],
    validations: [
      "representative must exist and have field role",
      "location reference must resolve or be confirmable",
      "plan_date must be valid",
      "representative sequence cannot duplicate for the same day",
    ],
  },
] as const;

const IMPORT_TEMPLATE_TYPES = new Set(
  IMPORT_TEMPLATES.map((template) => template.type),
);

@Injectable()
export class ImportsService {
  listTemplates(): ImportTemplateSummary[] {
    return IMPORT_TEMPLATES.map((template) => ({
      type: template.type,
      label: template.label,
      fileName: template.fileName,
      downloadPath: `/api/imports/templates/${template.type}.csv`,
      requiredColumns: template.columns
        .filter((column) => column.required)
        .map((column) => column.key),
      optionalColumns: template.columns
        .filter((column) => !column.required)
        .map((column) => column.key),
    }));
  }

  getTemplateCsv(templateFile: string): ImportTemplateDownload {
    const templateType = parseTemplateType(templateFile);
    const template = IMPORT_TEMPLATES.find(
      (candidate) => candidate.type === templateType,
    );

    if (!template) {
      throw new BadRequestException({
        code: "IMPORT_TEMPLATE_NOT_FOUND",
        message: "Import template is not supported.",
        details: { template: templateFile },
      });
    }

    return {
      fileName: template.fileName,
      contentType: CSV_CONTENT_TYPE,
      body: buildCsvTemplate(template),
    };
  }
}

function parseTemplateType(templateFile: string): ImportTemplateType {
  const normalizedFile = templateFile.trim().toLowerCase();
  const normalizedType = normalizedFile.endsWith(".csv")
    ? normalizedFile.slice(0, -4)
    : normalizedFile;

  if (IMPORT_TEMPLATE_TYPES.has(normalizedType as ImportTemplateType)) {
    return normalizedType as ImportTemplateType;
  }

  throw new BadRequestException({
    code: "IMPORT_TEMPLATE_NOT_FOUND",
    message: "Import template is not supported.",
    details: { template: templateFile },
  });
}

function buildCsvTemplate(template: ImportTemplateDefinition): string {
  const header = template.columns.map((column) => column.key);
  const descriptions = template.columns.map((column) => column.description);
  const required = template.columns.map((column) =>
    column.required ? "required" : "optional",
  );

  return [header, descriptions, required]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n")
    .concat("\n");
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}
