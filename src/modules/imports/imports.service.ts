import { BadRequestException, Injectable } from "@nestjs/common";
import { execFileSync } from "node:child_process";

import type {
  ImportTemplateDefinition,
  ImportTemplateDownload,
  ImportTemplateSummary,
  ImportTemplateType,
  ParsedImportFile,
  ParsedImportRow,
} from "./imports.types";

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const FIRST_WORKSHEET_PATH = "xl/worksheets/sheet1.xml";
const SHARED_STRINGS_PATH = "xl/sharedStrings.xml";

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

  parseApprovedXlsxTemplate(
    templateType: ImportTemplateType,
    filePath: string,
  ): ParsedImportFile {
    const template = getTemplateDefinition(templateType);
    const sharedStrings = readSharedStrings(filePath);
    const worksheetXml = readXlsxEntry(filePath, FIRST_WORKSHEET_PATH);
    const rows = parseWorksheetRows(worksheetXml, sharedStrings);
    const [rawHeader, ...rawDataRows] = rows;
    const columns = normalizeHeader(rawHeader ?? []);

    assertApprovedHeader(template, columns);

    return {
      templateType,
      columns,
      rows: rawDataRows
        .map((row) => mapRowToObject(columns, row))
        .filter((row) => Object.values(row).some((value) => value !== "")),
    };
  }

  parseApprovedCsvTemplate(
    templateType: ImportTemplateType,
    content: Buffer | string,
  ): ParsedImportFile {
    const template = getTemplateDefinition(templateType);
    const rows = parseCsvRows(content.toString("utf8"));
    const [rawHeader, ...rawDataRows] = rows;
    const columns = normalizeHeader(rawHeader ?? []);

    assertApprovedHeader(template, columns);

    return {
      templateType,
      columns,
      rows: rawDataRows
        .map((row) => mapRowToObject(columns, row))
        .filter((row) => Object.values(row).some((value) => value !== "")),
    };
  }
}

function getTemplateDefinition(
  templateType: ImportTemplateType,
): ImportTemplateDefinition {
  const template = IMPORT_TEMPLATES.find(
    (candidate) => candidate.type === templateType,
  );

  if (!template) {
    throw new BadRequestException({
      code: "IMPORT_TEMPLATE_NOT_FOUND",
      message: "Import template is not supported.",
      details: { template: templateType },
    });
  }

  return template;
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

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = content.charCodeAt(0) === 0xfeff ? 1 : 0;
  let inQuotes = false;

  while (index < content.length) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        index += 2;
        continue;
      }

      if (character === '"') {
        inQuotes = false;
        index += 1;
        continue;
      }

      cell += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }

    if (character === ",") {
      row.push(cell);
      cell = "";
      index += 1;
      continue;
    }

    if (character === "\n" || character === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";

      if (character === "\r" && nextCharacter === "\n") {
        index += 2;
      } else {
        index += 1;
      }

      continue;
    }

    cell += character;
    index += 1;
  }

  if (inQuotes) {
    throw new BadRequestException({
      code: "IMPORT_CSV_INVALID",
      message: "Uploaded CSV has an unterminated quoted field.",
    });
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function readSharedStrings(filePath: string): string[] {
  try {
    return parseSharedStrings(readXlsxEntry(filePath, SHARED_STRINGS_PATH));
  } catch (error) {
    if (error instanceof BadRequestException) {
      return [];
    }

    throw error;
  }
}

function readXlsxEntry(filePath: string, entryPath: string): string {
  try {
    return execFileSync("unzip", ["-p", filePath, entryPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new BadRequestException({
      code: "IMPORT_XLSX_INVALID",
      message: "Uploaded file is not a supported .xlsx workbook.",
      details: { entryPath },
    });
  }
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    extractTextValue(match[1] ?? ""),
  );
}

function parseWorksheetRows(
  xml: string,
  sharedStrings: readonly string[],
): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row: string[] = [];

    for (const cellMatch of (rowMatch[1] ?? "").matchAll(
      /<c\b([^>]*)>([\s\S]*?)<\/c>/g,
    )) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const columnIndex = getCellColumnIndex(attributes);

      if (columnIndex === null) {
        continue;
      }

      row[columnIndex] = parseCellValue(attributes, body, sharedStrings);
    }

    return row.map((value) => value ?? "");
  });
}

function getCellColumnIndex(attributes: string): number | null {
  const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];

  if (!reference) {
    return null;
  }

  let columnNumber = 0;

  for (const character of reference) {
    columnNumber = columnNumber * 26 + character.charCodeAt(0) - 64;
  }

  return columnNumber - 1;
}

function parseCellValue(
  attributes: string,
  body: string,
  sharedStrings: readonly string[],
): string {
  const cellType = attributes.match(/\bt="([^"]+)"/)?.[1];

  if (cellType === "inlineStr") {
    return extractTextValue(body).trim();
  }

  const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";

  if (cellType === "s") {
    return sharedStrings[Number(rawValue)]?.trim() ?? "";
  }

  return decodeXmlValue(rawValue).trim();
}

function extractTextValue(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXmlValue(match[1] ?? ""))
    .join("");
}

function decodeXmlValue(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function normalizeHeader(header: readonly string[]): string[] {
  return header.map((column) => column.trim().toLowerCase());
}

function assertApprovedHeader(
  template: ImportTemplateDefinition,
  columns: readonly string[],
): void {
  const approvedColumns = new Set(template.columns.map((column) => column.key));
  const requiredColumns = template.columns
    .filter((column) => column.required)
    .map((column) => column.key);
  const missingRequiredColumns = requiredColumns.filter(
    (column) => !columns.includes(column),
  );
  const unknownColumns = columns.filter(
    (column) => column && !approvedColumns.has(column),
  );

  if (missingRequiredColumns.length > 0 || unknownColumns.length > 0) {
    throw new BadRequestException({
      code: "IMPORT_XLSX_HEADER_INVALID",
      message: "Uploaded workbook does not match the approved import template.",
      details: {
        template: template.type,
        missingRequiredColumns,
        unknownColumns,
      },
    });
  }
}

function mapRowToObject(
  columns: readonly string[],
  row: readonly string[],
): ParsedImportRow {
  return columns.reduce<ParsedImportRow>((parsedRow, column, index) => {
    if (column) {
      parsedRow[column] = row[index]?.trim() ?? "";
    }

    return parsedRow;
  }, {});
}
