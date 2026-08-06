import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, RoleCode } from "@prisma/client";
import { execFileSync } from "node:child_process";

import { createCuid } from "../../common/cuid";
import { isValidEmail } from "../../common/normalize";
import { buildUserNameFields } from "../../common/person-name";
import { normalizePhoneInput } from "../../common/phone";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import { resolveLimit, type TextLimitKey } from "../../common/input-limits";
import type {
  CreateImportValidationJobOptions,
  ImportApplyResult,
  ImportJobHistoryItem,
  ImportPreviewIssue,
  ImportTemplateColumn,
  ImportTemplateDefinition,
  ImportTemplateDownload,
  ImportTemplateSummary,
  ImportTemplateType,
  ImportValidationPreview,
  ParsedImportFile,
  ParsedImportRow,
  StoredImportValidationPreview,
} from "./imports.types";

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const FIRST_WORKSHEET_PATH = "xl/worksheets/sheet1.xml";
const SHARED_STRINGS_PATH = "xl/sharedStrings.xml";
const DEFAULT_IMPORT_COUNTS: ImportApplyResult["createdCounts"] = {
  users: 0,
  userRoles: 0,
  chains: 0,
  locationCategories: 0,
  locations: 0,
  locationAssignments: 0,
  contacts: 0,
  products: 0,
  routePlans: 0,
  routeItems: 0,
  tasks: 0,
};

// The most rows one import file may hold. Nothing above this stack bounds the
// row count — `csvText` is capped only by `JSON_BODY_LIMIT`, deliberately, so a
// dense template (a products file is ~40 bytes a row) fits several thousand
// rows inside 100 kB. Two things need a stated ceiling rather than an emergent
// one:
//
//   - every apply* method below writes with `createMany`, and a batched INSERT
//     is one statement, so its bind parameters count against Postgres's 65 535
//     per-statement limit. The widest template writes ~15 columns a row, which
//     puts a 1 000-row file at ~15 000 parameters — comfortably inside it, and
//     a cap is what keeps it that way;
//   - past the ceiling the admin gets a blocking preview issue that names both
//     numbers and says to split the file, instead of discovering the limit as
//     a 500 at confirm time (audit F8).
//
// For a locations file the 100 kB body limit binds first (~790 real rows), so
// this cap fires exactly where the body limit does not.
const MAX_IMPORT_ROWS = 1000;

// The apply transaction's budget. Prisma's interactive-transaction defaults are
// `maxWait` 2 000 ms and `timeout` 5 000 ms, and no options were passed here at
// all — which, against the per-row query loops the apply* methods used to be,
// made a few-hundred-row file a deterministic dead end (audit F8). Those loops
// are now grouped lookups plus `createMany`, so a full file is a low double
// digit number of queries and finishes well inside the old 5 000 ms; this
// raised budget is headroom for a slow link between the API and the database,
// not the fix. Kept at the call site rather than as `transactionOptions` on
// `PrismaService` so it does not silently loosen every other transaction in the
// codebase.
const IMPORT_APPLY_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

type ImportCreatedCounts = ImportApplyResult["createdCounts"];
type PrismaTransaction = Prisma.TransactionClient;

// A location reference as an import row carries it: either an external code or
// a name, resolved against the tenant's existing locations.
type LocationReferenceInput = {
  externalCode: string | undefined;
  name: string | undefined;
};

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
        limit: "email",
      },
      {
        key: "first_name",
        required: true,
        description: "User given name.",
        limit: "name",
      },
      {
        key: "last_name",
        required: true,
        description: "User family name.",
        limit: "name",
      },
      {
        key: "roles",
        required: true,
        description: "Comma-separated role codes allowed for this tenant.",
        limit: "title",
      },
      {
        key: "phone",
        required: false,
        description: "Optional phone number.",
        limit: "phone",
      },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system user identifier.",
        limit: "code",
      },
    ],
    validations: [
      "email must be valid and unique within tenant",
      "first_name and last_name are both required",
      "roles must be allowed tenant roles",
      "duplicate emails in file are blocking",
      "phone must be a valid national or +international number if provided",
    ],
  },
  {
    type: "locations",
    label: "Locations",
    fileName: "vizitum-locations-template.csv",
    columns: [
      {
        key: "name",
        required: true,
        description: "Location name.",
        limit: "name",
      },
      {
        key: "address_line",
        required: true,
        description: "Street address or address line.",
        limit: "addressLine",
      },
      {
        key: "city",
        required: true,
        description: "Location city.",
        limit: "city",
      },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system location identifier.",
        limit: "code",
      },
      {
        key: "category",
        required: false,
        description:
          "Optional category name from the tenant's location category dictionary; unresolved names are created automatically on confirm.",
        limit: "name",
      },
      {
        key: "chain",
        required: false,
        description:
          "Optional retail chain/network name; created on first use and reused by name.",
        limit: "name",
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
        limit: "email",
      },
      {
        key: "notes",
        required: false,
        description: "Optional notes.",
        limit: "notes",
      },
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
        limit: "code",
      },
      {
        key: "location_name",
        required: false,
        description:
          "Fallback location reference when external code is absent.",
        limit: "name",
      },
      {
        key: "name",
        required: true,
        description: "Contact full name.",
        limit: "name",
      },
      {
        key: "role_title",
        required: false,
        description: "Contact role or title.",
        limit: "title",
      },
      {
        key: "phone",
        required: false,
        description: "Optional phone number.",
        limit: "phone",
      },
      {
        key: "email",
        required: false,
        description: "Optional email address.",
        limit: "email",
      },
      {
        key: "notes",
        required: false,
        description: "Optional notes.",
        limit: "notes",
      },
    ],
    validations: [
      "location_external_code or location_name is required",
      "location reference must resolve to exactly one location",
      "email must be valid if provided",
      "phone must be a valid national or +international number if provided",
    ],
  },
  {
    type: "products",
    label: "Products",
    fileName: "vizitum-products-template.csv",
    columns: [
      {
        key: "name",
        required: true,
        description: "Product name.",
        limit: "name",
      },
      {
        key: "external_code",
        required: false,
        description: "Optional source-system product identifier.",
        limit: "code",
      },
      {
        key: "sku",
        required: false,
        description: "Optional SKU.",
        limit: "code",
      },
      {
        key: "category",
        required: false,
        description: "Optional product category.",
        limit: "name",
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
        limit: "email",
      },
      {
        key: "location_external_code",
        required: false,
        description: "Preferred location reference.",
        limit: "code",
      },
      {
        key: "location_name",
        required: false,
        description:
          "Fallback location reference when external code is absent.",
        limit: "name",
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
        limit: "title",
      },
      {
        key: "task_due_date",
        required: false,
        description: "Optional task due date in YYYY-MM-DD format.",
      },
      {
        key: "task_priority",
        required: false,
        description: "Optional task priority: normal or priority.",
        limit: "code",
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

// The locations template's `type` column was renamed to `category` (it now
// resolves against the tenant's category dictionary instead of being stored
// as free text). Existing exports/files built against the old template still
// carry a `type` header — accept it as an alias so those files keep working,
// while templates/samples only ever advertise `category`.
const LEGACY_COLUMN_ALIASES: Partial<
  Record<ImportTemplateType, Record<string, string>>
> = {
  locations: { type: "category" },
};

function applyLegacyColumnAliases(
  templateType: ImportTemplateType,
  columns: readonly string[],
): string[] {
  const aliases = LEGACY_COLUMN_ALIASES[templateType];

  if (!aliases) {
    return [...columns];
  }

  return columns.map((column) => aliases[column] ?? column);
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma?: PrismaService) {}

  listTemplates(): ImportTemplateSummary[] {
    return IMPORT_TEMPLATES.map((template) => ({
      type: template.type,
      label: template.label,
      fileName: template.fileName,
      downloadPath: `/imports/templates/${template.type}.csv`,
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
    const columns = applyLegacyColumnAliases(
      templateType,
      normalizeHeader(rawHeader ?? []),
    );

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
    const columns = applyLegacyColumnAliases(
      templateType,
      normalizeHeader(rawHeader ?? []),
    );

    assertApprovedHeader(template, columns);

    return {
      templateType,
      columns,
      rows: rawDataRows
        .map((row) => mapRowToObject(columns, row))
        .filter((row) => Object.values(row).some((value) => value !== "")),
    };
  }

  async validateImportPreview(
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const prisma = this.getPrisma();

    switch (parsedFile.templateType) {
      case "users":
        return this.validateUsersPreview(prisma, context, parsedFile);
      case "locations":
        return this.validateLocationsPreview(prisma, context, parsedFile);
      case "contacts":
        return this.validateContactsPreview(prisma, context, parsedFile);
      case "products":
        return this.validateProductsPreview(prisma, context, parsedFile);
      case "initial_visit_task_plan":
        return this.validateInitialPlanPreview(prisma, context, parsedFile);
    }
  }

  async createImportValidationJob(
    context: RequestContext,
    parsedFile: ParsedImportFile,
    options: CreateImportValidationJobOptions = {},
  ): Promise<StoredImportValidationPreview> {
    if (!context.userId) {
      throw new BadRequestException({
        code: "IMPORT_UPLOADER_REQUIRED",
        message: "Authenticated user is required to create an import job.",
      });
    }

    const uploadedByUserId = context.userId;
    const prisma = this.getPrisma();
    const preview = await this.validateImportPreview(context, parsedFile);
    const status = preview.canConfirm ? "validated" : "validation_failed";
    const validatedAt = new Date();

    const importJob = await prisma.$transaction(async (transaction) => {
      const createdJob = await transaction.importJob.create({
        data: {
          tenantId: context.tenantId,
          type: parsedFile.templateType,
          status,
          sourceFileObjectId: options.sourceFileObjectId,
          sourceFileName: options.sourceFileName,
          uploadedByUserId,
          rowCount: preview.rowCount,
          validRowCount: preview.validRowCount,
          errorRowCount: preview.errorRowCount,
          warningRowCount: preview.warningRowCount,
          summary: {
            templateType: preview.templateType,
            columns: parsedFile.columns,
            rows: parsedFile.rows,
            canConfirm: preview.canConfirm,
          },
          validatedAt,
        } satisfies Prisma.ImportJobUncheckedCreateInput,
        select: { id: true },
      });

      if (preview.issues.length > 0) {
        await transaction.importRowIssue.createMany({
          data: preview.issues.map((issue) => ({
            tenantId: context.tenantId,
            importJobId: createdJob.id,
            rowNumber: issue.rowNumber,
            fieldName: issue.fieldName,
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
            rawValue: issue.rawValue,
          })),
        });
      }

      return createdJob;
    });

    return {
      ...preview,
      importJobId: importJob.id,
      status,
      validatedAt: validatedAt.toISOString(),
      sourceFileName: options.sourceFileName ?? null,
    };
  }

  async getImportValidationJob(
    context: RequestContext,
    importJobId: string,
  ): Promise<StoredImportValidationPreview> {
    const prisma = this.getPrisma();
    const importJob = await prisma.importJob.findFirst({
      where: {
        id: importJobId,
        tenantId: context.tenantId,
      },
      include: {
        issues: {
          orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!importJob) {
      throw new NotFoundException({
        code: "IMPORT_JOB_NOT_FOUND",
        message: "Import job was not found.",
      });
    }

    if (
      importJob.status !== "validated" &&
      importJob.status !== "validation_failed"
    ) {
      throw new ConflictException({
        code: "IMPORT_JOB_NOT_VALIDATION_PREVIEW",
        message: "Import job is not a validation preview.",
      });
    }

    return {
      templateType: importJob.type,
      rowCount: importJob.rowCount,
      validRowCount: importJob.validRowCount,
      errorRowCount: importJob.errorRowCount,
      warningRowCount: importJob.warningRowCount,
      canConfirm:
        importJob.status === "validated" && importJob.errorRowCount === 0,
      issues: importJob.issues.map((issue) => ({
        rowNumber: issue.rowNumber,
        fieldName: issue.fieldName ?? undefined,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        rawValue: issue.rawValue ?? undefined,
      })),
      importJobId: importJob.id,
      status: importJob.status,
      validatedAt: importJob.validatedAt
        ? importJob.validatedAt.toISOString()
        : null,
      sourceFileName: importJob.sourceFileName ?? null,
    };
  }

  async listImportJobs(
    context: RequestContext,
  ): Promise<ImportJobHistoryItem[]> {
    const prisma = this.getPrisma();
    const importJobs = await prisma.importJob.findMany({
      where: {
        tenantId: context.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
      include: {
        uploadedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        confirmedBy: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return importJobs.map((importJob) => ({
      id: importJob.id,
      templateType: importJob.type,
      status: importJob.status,
      rowCount: importJob.rowCount,
      validRowCount: importJob.validRowCount,
      errorRowCount: importJob.errorRowCount,
      warningRowCount: importJob.warningRowCount,
      uploadedBy: importJob.uploadedBy,
      confirmedBy: importJob.confirmedBy,
      createdCounts: readAppliedCounts(importJob.summary),
      createdAt: importJob.createdAt,
      validatedAt: importJob.validatedAt,
      confirmedAt: importJob.confirmedAt,
      appliedAt: importJob.appliedAt,
      failedAt: importJob.failedAt,
    }));
  }

  async confirmImportJob(
    context: RequestContext,
    importJobId: string,
  ): Promise<ImportApplyResult> {
    if (!context.userId) {
      throw new BadRequestException({
        code: "IMPORT_CONFIRMER_REQUIRED",
        message: "Authenticated user is required to confirm an import job.",
      });
    }

    const confirmedByUserId = context.userId;
    const prisma = this.getPrisma();
    const importJob = await prisma.importJob.findFirst({
      where: {
        id: importJobId,
        tenantId: context.tenantId,
      },
      select: {
        id: true,
        type: true,
        status: true,
        errorRowCount: true,
        summary: true,
      },
    });

    if (!importJob) {
      throw new NotFoundException({
        code: "IMPORT_JOB_NOT_FOUND",
        message: "Import job was not found.",
      });
    }

    if (importJob.status === "applied") {
      throw new ConflictException({
        code: "IMPORT_ALREADY_APPLIED",
        message: "Import job has already been applied.",
      });
    }

    if (importJob.status !== "validated" || importJob.errorRowCount > 0) {
      throw new ConflictException({
        code: "IMPORT_NOT_CONFIRMABLE",
        message: "Only validated imports without errors can be confirmed.",
      });
    }

    const parsedFile = parseStoredParsedFile(importJob.type, importJob.summary);

    // Validation blocks an over-cap file at preview time, so reaching here
    // means a job stored before the cap existed. Refuse it with the same
    // reason rather than letting it into the apply transaction.
    assertRowCountWithinLimit(parsedFile.rows.length);

    const createdCounts = await prisma.$transaction(async (transaction) => {
      // The status check above happened outside this transaction, so two
      // confirms of the same job could both reach here and apply every row
      // twice — duplicate users, duplicate locations, a second set of route
      // plans. Claiming the job with a conditional update makes exactly one
      // of them the winner: the loser blocks on the row until the first
      // commits, then matches nothing.
      const { count } = await transaction.importJob.updateMany({
        where: { id: importJob.id, status: "validated" },
        data: {
          status: "confirmed",
          confirmedByUserId,
          confirmedAt: new Date(),
        },
      });

      if (count === 0) {
        throw new ConflictException({
          code: "IMPORT_ALREADY_APPLIED",
          message: "Import job has already been applied.",
        });
      }

      const counts = { ...DEFAULT_IMPORT_COUNTS };

      switch (parsedFile.templateType) {
        case "users":
          await this.applyUsersImport(transaction, context, parsedFile, counts);
          break;
        case "locations":
          await this.applyLocationsImport(
            transaction,
            context,
            parsedFile,
            counts,
          );
          break;
        case "contacts":
          await this.applyContactsImport(
            transaction,
            context,
            parsedFile,
            counts,
          );
          break;
        case "products":
          await this.applyProductsImport(
            transaction,
            context,
            parsedFile,
            counts,
          );
          break;
        case "initial_visit_task_plan":
          await this.applyInitialPlanImport(
            transaction,
            context,
            parsedFile,
            counts,
          );
          break;
      }

      await transaction.importJob.update({
        where: { id: importJob.id },
        data: {
          status: "applied",
          confirmedByUserId,
          confirmedAt: new Date(),
          appliedAt: new Date(),
          summary: {
            templateType: parsedFile.templateType,
            columns: parsedFile.columns,
            rows: parsedFile.rows,
            canConfirm: true,
            appliedCounts: counts,
          },
        },
      });

      return counts;
    }, IMPORT_APPLY_TRANSACTION_OPTIONS);

    return {
      importJobId: importJob.id,
      status: "applied",
      appliedRowCount: parsedFile.rows.length,
      createdCounts,
    };
  }

  // Every apply* method below is written as "resolve all references in grouped
  // lookups, then write with createMany" rather than as a per-row loop, so the
  // query count is a function of the number of tables an import touches and not
  // of its row count. That is the whole of audit F8: the loops these replaced
  // issued 5-7 awaited queries a row inside a transaction with a fixed budget,
  // so the file that could be applied got smaller as the database got further
  // away. `src/modules/visits/shelf-check.ts:94` states the same reasoning for
  // the same reason — it also sits inside a confirm transaction.
  private async applyUsersImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    if (parsedFile.rows.length === 0) {
      return;
    }

    const phoneCountry = await this.getTenantPhoneCountry(
      transaction,
      context.tenantId,
    );

    // createManyAndReturn rather than createMany because the role rows need the
    // generated ids. Correlated by email rather than by position: email is the
    // tenant-unique column here, and validation blocks both duplicates within
    // the file and addresses that already exist.
    const createdUsers = await transaction.user.createManyAndReturn({
      data: parsedFile.rows.map((row) => ({
        tenantId: context.tenantId,
        email: normalizeValue(row.email),
        ...buildUserNameFields({
          firstName: requiredString(row.first_name),
          lastName: requiredString(row.last_name),
        }),
        phone: optionalPhone(row.phone, phoneCountry),
        status: "invited" as const,
      })),
      select: { id: true, email: true },
    });

    counts.users += createdUsers.length;

    const userIdByEmail = new Map(
      createdUsers.map((user) => [user.email, user.id]),
    );
    const roleRows = parsedFile.rows.flatMap((row) => {
      const userId = userIdByEmail.get(normalizeValue(row.email));

      if (!userId) {
        return [];
      }

      return parseRoleCodes(row.roles)
        .filter(isTenantRoleCode)
        .map((roleCode) => ({
          tenantId: context.tenantId,
          userId,
          roleCode,
          assignedByUserId: context.userId,
        }));
    });

    if (roleRows.length > 0) {
      await transaction.userRole.createMany({ data: roleRows });
      counts.userRoles += roleRows.length;
    }
  }

  private async applyLocationsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    if (parsedFile.rows.length === 0) {
      return;
    }

    const chainIdByName = await this.resolveChainReferences(
      transaction,
      context,
      parsedFile.rows.map((row) => row.chain),
      counts,
    );
    const categoryIdByName = await this.resolveLocationCategoryReferences(
      transaction,
      context,
      parsedFile.rows.map((row) => row.category),
      counts,
    );
    const representativeIdByEmail = await this.resolveUserIdsByEmailOrThrow(
      transaction,
      context.tenantId,
      parsedFile.rows.map((row) => row.assigned_representative_email),
    );

    // Ids are minted here rather than read back from the insert. A location has
    // no column that is unique within an import file — `external_code` is
    // optional and `name` is not unique — so pairing a returned row with its
    // source row would have to be done by position, which means trusting that
    // `createManyAndReturn` hands rows back in VALUES order. Postgres does;
    // Prisma does not promise it. The failure would be silent and plausible:
    // representatives attached to the wrong outlets, every row present, no
    // error. Prisma generates `@default(cuid())` ids client-side anyway (the
    // `id` column is in the INSERT it emits), so supplying them makes the
    // correlation exact instead of merely reliable — and lets this be a plain
    // `createMany`, with nothing to return.
    const locationRows = parsedFile.rows.map((row) => ({
      id: createCuid(),
      tenantId: context.tenantId,
      chainId: chainIdByName.get(normalizeValue(row.chain)) ?? null,
      categoryId: categoryIdByName.get(normalizeValue(row.category)) ?? null,
      externalCode: optionalString(row.external_code),
      name: requiredString(row.name),
      addressLine: requiredString(row.address_line),
      city: requiredString(row.city),
      latitude: optionalNumber(row.latitude),
      longitude: optionalNumber(row.longitude),
      notes: optionalString(row.notes),
    }));

    await transaction.location.createMany({ data: locationRows });
    counts.locations += locationRows.length;

    const assignmentRows = parsedFile.rows.flatMap((row, index) => {
      const representativeEmail = normalizeValue(
        row.assigned_representative_email,
      );
      const locationId = locationRows[index]?.id;

      if (!representativeEmail || !locationId) {
        return [];
      }

      return [
        {
          tenantId: context.tenantId,
          locationId,
          representativeUserId: requireReference(
            representativeIdByEmail.get(representativeEmail),
          ),
          assignedByUserId: context.userId,
          status: "active" as const,
        },
      ];
    });

    if (assignmentRows.length > 0) {
      await transaction.locationAssignment.createMany({ data: assignmentRows });
      counts.locationAssignments += assignmentRows.length;
    }
  }

  private async applyContactsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    if (parsedFile.rows.length === 0) {
      return;
    }

    const phoneCountry = await this.getTenantPhoneCountry(
      transaction,
      context.tenantId,
    );
    const locationIds = await this.resolveLocationIdsOrThrow(
      transaction,
      context.tenantId,
      parsedFile.rows.map((row) => ({
        externalCode: row.location_external_code,
        name: row.location_name,
      })),
    );

    await transaction.locationContact.createMany({
      data: parsedFile.rows.map((row, index) => ({
        tenantId: context.tenantId,
        locationId: requireReference(locationIds[index]),
        name: requiredString(row.name),
        roleTitle: optionalString(row.role_title),
        phone: optionalPhone(row.phone, phoneCountry),
        email: optionalString(row.email),
        notes: optionalString(row.notes),
      })),
    });
    counts.contacts += parsedFile.rows.length;
  }

  private async applyProductsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    if (parsedFile.rows.length === 0) {
      return;
    }

    await transaction.product.createMany({
      data: parsedFile.rows.map((row) => ({
        tenantId: context.tenantId,
        externalCode: optionalString(row.external_code),
        name: requiredString(row.name),
        sku: optionalString(row.sku),
        category: optionalString(row.category),
      })),
    });
    counts.products += parsedFile.rows.length;
  }

  private async applyInitialPlanImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    if (parsedFile.rows.length === 0) {
      return;
    }

    const representativeIdByEmail = await this.resolveUserIdsByEmailOrThrow(
      transaction,
      context.tenantId,
      parsedFile.rows.map((row) => row.representative_email),
      "field_representative",
    );
    const locationIds = await this.resolveLocationIdsOrThrow(
      transaction,
      context.tenantId,
      parsedFile.rows.map((row) => ({
        externalCode: row.location_external_code,
        name: row.location_name,
      })),
    );

    const resolvedRows = parsedFile.rows.map((row, index) => ({
      row,
      representativeUserId: requireReference(
        representativeIdByEmail.get(normalizeValue(row.representative_email)),
      ),
      locationId: requireReference(locationIds[index]),
      planDate: parseDateOnly(row.plan_date),
    }));

    // Imported plans are always template-less, so they fall under the
    // partial unique index scoped to routeTemplateId IS NULL
    // (route_plans_rep_date_no_template_key) — the compound
    // tenantId_representativeUserId_planDate key this used to look up no
    // longer exists now that a representative can hold several
    // template-based plans on the same day (see the
    // 20260721062916_route_plan_multi_per_day migration).
    //
    // One lookup for every distinct (representative, date) pair in the file
    // rather than one a row, which also collapses repeats within the file the
    // way the per-row get-or-create did by reading its own earlier writes.
    const wantedPlans = new Map<
      string,
      { representativeUserId: string; planDate: Date }
    >();

    for (const resolved of resolvedRows) {
      wantedPlans.set(
        routePlanKey(resolved.representativeUserId, resolved.planDate),
        {
          representativeUserId: resolved.representativeUserId,
          planDate: resolved.planDate,
        },
      );
    }

    const existingPlans = await transaction.routePlan.findMany({
      where: {
        tenantId: context.tenantId,
        routeTemplateId: null,
        OR: [...wantedPlans.values()].map(
          ({ representativeUserId, planDate }) => ({
            representativeUserId,
            planDate,
          }),
        ),
      },
      select: { id: true, representativeUserId: true, planDate: true },
    });
    const routePlanIdByKey = new Map<string, string>();

    for (const plan of existingPlans) {
      const key = routePlanKey(plan.representativeUserId, plan.planDate);

      if (!routePlanIdByKey.has(key)) {
        routePlanIdByKey.set(key, plan.id);
      }
    }

    const missingPlans = [...wantedPlans.values()].filter(
      (plan) =>
        !routePlanIdByKey.has(
          routePlanKey(plan.representativeUserId, plan.planDate),
        ),
    );

    if (missingPlans.length > 0) {
      const createdPlans = await transaction.routePlan.createManyAndReturn({
        data: missingPlans.map((plan) => ({
          tenantId: context.tenantId,
          representativeUserId: plan.representativeUserId,
          planDate: plan.planDate,
          createdByUserId: context.userId,
        })),
        select: { id: true, representativeUserId: true, planDate: true },
      });

      for (const plan of createdPlans) {
        routePlanIdByKey.set(
          routePlanKey(plan.representativeUserId, plan.planDate),
          plan.id,
        );
      }

      counts.routePlans += createdPlans.length;
    }

    // A row with no explicit sequence takes the next free slot in its plan.
    // The per-row version read that by counting the plan's items, which inside
    // the transaction included the items earlier rows of this same file had
    // just written — so the cursor has to advance on every item, not only the
    // implicitly numbered ones. Plans created above start empty; only the
    // reused ones need a count.
    const existingPlanIds = [...new Set(existingPlans.map((plan) => plan.id))];
    const nextSequenceByPlan = new Map<string, number>();

    if (existingPlanIds.length > 0) {
      const itemCounts = await transaction.routeItem.groupBy({
        by: ["routePlanId"],
        where: {
          tenantId: context.tenantId,
          routePlanId: { in: existingPlanIds },
        },
        _count: { _all: true },
      });

      for (const itemCount of itemCounts) {
        nextSequenceByPlan.set(
          itemCount.routePlanId,
          itemCount._count._all + 1,
        );
      }
    }

    const routeItemRows = resolvedRows.map(
      ({ row, representativeUserId, locationId, planDate }) => {
        const routePlanId = requireReference(
          routePlanIdByKey.get(routePlanKey(representativeUserId, planDate)),
        );
        const nextSequence = nextSequenceByPlan.get(routePlanId) ?? 1;

        nextSequenceByPlan.set(routePlanId, nextSequence + 1);

        return {
          tenantId: context.tenantId,
          routePlanId,
          locationId,
          sequence: optionalPositiveInteger(row.sequence) ?? nextSequence,
          plannedStartTime: optionalPlanDateTime(
            row.plan_date,
            row.planned_start_time,
          ),
          plannedEndTime: optionalPlanDateTime(
            row.plan_date,
            row.planned_end_time,
          ),
        };
      },
    );

    await transaction.routeItem.createMany({ data: routeItemRows });
    counts.routeItems += routeItemRows.length;

    const taskRows = resolvedRows.flatMap(
      ({ row, representativeUserId, locationId }) => {
        const taskTitle = optionalString(row.task_title);

        if (!taskTitle) {
          return [];
        }

        return [
          {
            tenantId: context.tenantId,
            title: taskTitle,
            isPriority: parseTaskIsPriority(row.task_priority),
            assignedToUserId: representativeUserId,
            createdByUserId: context.userId,
            locationId,
            dueDate: row.task_due_date
              ? parseDateOnly(row.task_due_date)
              : null,
          },
        ];
      },
    );

    if (taskRows.length > 0) {
      await transaction.task.createMany({ data: taskRows });
      counts.tasks += taskRows.length;
    }
  }

  // Resolve every representative an import file names, in one lookup, keyed by
  // the normalized email. A reference that no longer resolves fails the whole
  // import — the per-row version raised the same error, just after writing the
  // rows before it and rolling them back again.
  private async resolveUserIdsByEmailOrThrow(
    transaction: PrismaTransaction,
    tenantId: string,
    emailInputs: (string | undefined)[],
    requiredRoleCode?: RoleCode,
  ): Promise<Map<string, string>> {
    const emails = [
      ...new Set(emailInputs.map(normalizeValue).filter(isPresent)),
    ];

    if (emails.length === 0) {
      return new Map();
    }

    const users = await transaction.user.findMany({
      where: {
        tenantId,
        email: { in: emails },
        status: "active",
        deletedAt: null,
        roles: requiredRoleCode
          ? { some: { tenantId, roleCode: requiredRoleCode } }
          : undefined,
      },
      select: { id: true, email: true },
    });
    const userIdByEmail = new Map(users.map((user) => [user.email, user.id]));

    for (const email of emails) {
      if (!userIdByEmail.has(email)) {
        throwImportReferenceNotFound();
      }
    }

    return userIdByEmail;
  }

  // Resolve the chains a location import names, creating the ones that do not
  // exist yet so a chain column can populate the canonical list without a
  // separate upload. Matching is case-insensitive to avoid duplicating an
  // existing chain that differs only in casing, and — unlike location
  // categories — an auto-created chain is stored normalized rather than as
  // typed, which is what the per-row version did too. Returns a map from the
  // normalized name to the chain id; a row with no chain finds nothing in it
  // and writes a null chainId.
  private async resolveChainReferences(
    transaction: PrismaTransaction,
    context: RequestContext,
    nameInputs: (string | undefined)[],
    counts: ImportCreatedCounts,
  ): Promise<Map<string, string>> {
    const names = [
      ...new Set(nameInputs.map(normalizeValue).filter(isPresent)),
    ];

    if (names.length === 0) {
      return new Map();
    }

    // An OR of per-name insensitive equals rather than `in`, so the comparison
    // is exactly the one the per-row `findFirst` made.
    const existingChains = await transaction.chain.findMany({
      where: {
        tenantId: context.tenantId,
        deletedAt: null,
        OR: names.map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      },
      select: { id: true, name: true },
    });
    const chainIdByName = new Map<string, string>();

    for (const chain of existingChains) {
      const key = normalizeValue(chain.name);

      if (!chainIdByName.has(key)) {
        chainIdByName.set(key, chain.id);
      }
    }

    const missingNames = names.filter((name) => !chainIdByName.has(name));

    if (missingNames.length > 0) {
      const createdChains = await transaction.chain.createManyAndReturn({
        data: missingNames.map((name) => ({
          tenantId: context.tenantId,
          name,
        })),
        select: { id: true, name: true },
      });

      for (const chain of createdChains) {
        chainIdByName.set(normalizeValue(chain.name), chain.id);
      }

      counts.chains += createdChains.length;
    }

    return chainIdByName;
  }

  // Resolve the location categories an import names, creating the ones the
  // tenant's dictionary does not hold yet — an import is run by an admin, so
  // authorship of an auto-created category stays with them. The lookup is
  // case-insensitive, so repeated or case-variant names within the same file
  // collapse onto one category, but unlike `resolveChainReferences` the display
  // name is stored exactly as first typed in the file — matching the "stored
  // exactly as typed" rule the rest of the category dictionary follows (manual
  // create/rename, migration backfill). Returns a map from the normalized name
  // to the category id.
  private async resolveLocationCategoryReferences(
    transaction: PrismaTransaction,
    context: RequestContext,
    nameInputs: (string | undefined)[],
    counts: ImportCreatedCounts,
  ): Promise<Map<string, string>> {
    // First-seen casing wins, which is the casing the per-row version created
    // the category with.
    const typedNameByKey = new Map<string, string>();

    for (const nameInput of nameInputs) {
      const name = optionalString(nameInput);

      if (!name) {
        continue;
      }

      const key = normalizeValue(name);

      if (!typedNameByKey.has(key)) {
        typedNameByKey.set(key, name);
      }
    }

    if (typedNameByKey.size === 0) {
      return new Map();
    }

    const existingCategories = await transaction.locationCategory.findMany({
      where: {
        tenantId: context.tenantId,
        OR: [...typedNameByKey.values()].map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      },
      select: { id: true, name: true },
    });
    const categoryIdByName = new Map<string, string>();

    for (const category of existingCategories) {
      const key = normalizeValue(category.name);

      if (!categoryIdByName.has(key)) {
        categoryIdByName.set(key, category.id);
      }
    }

    const missingNames = [...typedNameByKey.entries()].filter(
      ([key]) => !categoryIdByName.has(key),
    );

    if (missingNames.length > 0) {
      const createdCategories =
        await transaction.locationCategory.createManyAndReturn({
          data: missingNames.map(([, name]) => ({
            tenantId: context.tenantId,
            name,
          })),
          select: { id: true, name: true },
        });

      for (const category of createdCategories) {
        categoryIdByName.set(normalizeValue(category.name), category.id);
      }

      counts.locationCategories += createdCategories.length;
    }

    return categoryIdByName;
  }

  // Resolve one location id per input reference, positionally, in at most two
  // lookups. An external code wins over a name where a row carries both, and a
  // name that matches more than one location is as unresolvable as one that
  // matches none — both are what the per-row version did.
  private async resolveLocationIdsOrThrow(
    transaction: PrismaTransaction,
    tenantId: string,
    references: LocationReferenceInput[],
  ): Promise<string[]> {
    const externalCodes = new Set<string>();
    const names = new Set<string>();

    for (const reference of references) {
      const externalCode = normalizeValue(reference.externalCode);

      if (externalCode) {
        externalCodes.add(externalCode);
        continue;
      }

      names.add(normalizeValue(reference.name));
    }

    const locationIdByExternalCode = new Map<string, string>();

    if (externalCodes.size > 0) {
      const locations = await transaction.location.findMany({
        where: {
          tenantId,
          externalCode: { in: [...externalCodes] },
          deletedAt: null,
        },
        select: { id: true, externalCode: true },
      });

      for (const location of locations) {
        const externalCode = location.externalCode;

        if (externalCode && !locationIdByExternalCode.has(externalCode)) {
          locationIdByExternalCode.set(externalCode, location.id);
        }
      }

      for (const externalCode of externalCodes) {
        if (!locationIdByExternalCode.has(externalCode)) {
          throwImportReferenceNotFound();
        }
      }
    }

    const locationIdByName = new Map<string, string>();

    if (names.size > 0) {
      const locations = await transaction.location.findMany({
        where: {
          tenantId,
          name: { in: [...names] },
          deletedAt: null,
        },
        select: { id: true, name: true },
      });
      const idsByName = new Map<string, string[]>();

      for (const location of locations) {
        const ids = idsByName.get(location.name) ?? [];

        ids.push(location.id);
        idsByName.set(location.name, ids);
      }

      for (const name of names) {
        const ids = idsByName.get(name) ?? [];

        if (ids.length !== 1 || !ids[0]) {
          throwImportReferenceNotFound();
        }

        locationIdByName.set(name, ids[0]);
      }
    }

    return references.map((reference) => {
      const externalCode = normalizeValue(reference.externalCode);

      if (externalCode) {
        return requireReference(locationIdByExternalCode.get(externalCode));
      }

      return requireReference(
        locationIdByName.get(normalizeValue(reference.name)),
      );
    });
  }

  private async validateUsersPreview(
    prisma: PrismaService,
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const issues: ImportPreviewIssue[] = [];
    const phoneCountry = await this.getTenantPhoneCountry(
      prisma,
      context.tenantId,
    );
    const emailCounts = countNormalizedValues(parsedFile.rows, "email");
    const existingUsers = await prisma.user.findMany({
      where: {
        tenantId: context.tenantId,
        email: { in: [...emailCounts.keys()] },
        deletedAt: null,
      },
      select: { email: true },
    });
    const existingEmails = new Set(existingUsers.map((user) => user.email));

    parsedFile.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      addRequiredIssues(issues, row, rowNumber, [
        "email",
        "first_name",
        "last_name",
        "roles",
      ]);
      addEmailIssue(issues, row, rowNumber, "email");
      addPhoneIssue(issues, row, rowNumber, "phone", phoneCountry);

      const email = normalizeValue(row.email);

      if (email && (emailCounts.get(email) ?? 0) > 1) {
        issues.push(
          createIssue(
            rowNumber,
            "email",
            "error",
            "DUPLICATE_EMAIL_IN_FILE",
            "Email is duplicated in this file.",
            row.email,
          ),
        );
      }

      if (email && existingEmails.has(email)) {
        issues.push(
          createIssue(
            rowNumber,
            "email",
            "error",
            "EMAIL_ALREADY_EXISTS",
            "User email already exists in this tenant.",
            row.email,
          ),
        );
      }

      for (const roleCode of parseRoleCodes(row.roles)) {
        if (!isTenantRoleCode(roleCode)) {
          issues.push(
            createIssue(
              rowNumber,
              "roles",
              "error",
              "ROLE_NOT_ALLOWED",
              "Role must be one of the allowed tenant roles.",
              roleCode,
            ),
          );
        }
      }
    });

    return buildPreview(parsedFile, issues);
  }

  private async validateLocationsPreview(
    prisma: PrismaService,
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const issues: ImportPreviewIssue[] = [];
    const externalCodeCounts = countNormalizedValues(
      parsedFile.rows,
      "external_code",
    );
    const nameAddressCounts = countCompositeValues(parsedFile.rows, [
      "name",
      "address_line",
      "city",
    ]);
    const representativeEmails = collectNormalizedValues(
      parsedFile.rows,
      "assigned_representative_email",
    );
    const categoryNames = collectNormalizedValues(parsedFile.rows, "category");
    const existingExternalCodes = await this.findExistingLocationExternalCodes(
      prisma,
      context.tenantId,
      [...externalCodeCounts.keys()],
    );
    const existingRepresentatives = await this.findExistingUsersByEmail(
      prisma,
      context.tenantId,
      [...representativeEmails],
    );
    const existingCategoryNames = await this.findExistingLocationCategoryNames(
      prisma,
      context.tenantId,
      [...categoryNames],
    );
    // One warning per distinct new category name (not per row), attached to
    // the first row that introduces it — so a repeated or case-variant name
    // later in the file doesn't announce the same to-be-created category
    // again.
    const announcedNewCategoryKeys = new Set<string>();

    parsedFile.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      addRequiredIssues(issues, row, rowNumber, [
        "name",
        "address_line",
        "city",
      ]);
      addDecimalIssue(issues, row, rowNumber, "latitude", -90, 90);
      addDecimalIssue(issues, row, rowNumber, "longitude", -180, 180);

      const externalCode = normalizeValue(row.external_code);

      if (externalCode && (externalCodeCounts.get(externalCode) ?? 0) > 1) {
        issues.push(
          createIssue(
            rowNumber,
            "external_code",
            "error",
            "DUPLICATE_EXTERNAL_CODE_IN_FILE",
            "External code is duplicated in this file.",
            row.external_code,
          ),
        );
      }

      if (externalCode && existingExternalCodes.has(externalCode)) {
        issues.push(
          createIssue(
            rowNumber,
            "external_code",
            "error",
            "EXTERNAL_CODE_ALREADY_EXISTS",
            "Location external code already exists in this tenant.",
            row.external_code,
          ),
        );
      }

      const representativeEmail = normalizeValue(
        row.assigned_representative_email,
      );

      if (
        representativeEmail &&
        !existingRepresentatives.has(representativeEmail)
      ) {
        issues.push(
          createIssue(
            rowNumber,
            "assigned_representative_email",
            "error",
            "REPRESENTATIVE_NOT_FOUND",
            "Assigned representative must exist in this tenant.",
            row.assigned_representative_email,
          ),
        );
      }

      const nameAddressKey = compositeKey(row, [
        "name",
        "address_line",
        "city",
      ]);

      if (nameAddressKey && (nameAddressCounts.get(nameAddressKey) ?? 0) > 1) {
        issues.push(
          createIssue(
            rowNumber,
            "name",
            "warning",
            "POSSIBLE_DUPLICATE_LOCATION",
            "Duplicate name/address appears in this file.",
            row.name,
          ),
        );
      }

      const categoryName = normalizeValue(row.category);

      if (
        categoryName &&
        !existingCategoryNames.has(categoryName) &&
        !announcedNewCategoryKeys.has(categoryName)
      ) {
        issues.push(
          createIssue(
            rowNumber,
            "category",
            "warning",
            "LOCATION_CATEGORY_WILL_BE_CREATED",
            "Category does not exist yet and will be created on confirm.",
            row.category,
          ),
        );
        announcedNewCategoryKeys.add(categoryName);
      }
    });

    return buildPreview(parsedFile, issues);
  }

  private async validateContactsPreview(
    prisma: PrismaService,
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const issues: ImportPreviewIssue[] = [];
    const phoneCountry = await this.getTenantPhoneCountry(
      prisma,
      context.tenantId,
    );
    const locationExternalCodes = collectNormalizedValues(
      parsedFile.rows,
      "location_external_code",
    );
    const locationNames = collectNormalizedValues(
      parsedFile.rows,
      "location_name",
    );
    const existingExternalCodes = await this.findExistingLocationExternalCodes(
      prisma,
      context.tenantId,
      [...locationExternalCodes],
    );
    const locationNameCounts = await this.countLocationsByName(
      prisma,
      context.tenantId,
      [...locationNames],
    );

    parsedFile.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      addRequiredIssues(issues, row, rowNumber, ["name"]);
      addEmailIssue(issues, row, rowNumber, "email");
      addPhoneIssue(issues, row, rowNumber, "phone", phoneCountry);

      const locationExternalCode = normalizeValue(row.location_external_code);
      const locationName = normalizeValue(row.location_name);

      if (!locationExternalCode && !locationName) {
        issues.push(
          createIssue(
            rowNumber,
            "location_external_code",
            "error",
            "LOCATION_REFERENCE_REQUIRED",
            "location_external_code or location_name is required.",
            "",
          ),
        );
        return;
      }

      if (
        locationExternalCode &&
        !existingExternalCodes.has(locationExternalCode)
      ) {
        issues.push(
          createIssue(
            rowNumber,
            "location_external_code",
            "error",
            "LOCATION_NOT_FOUND",
            "Location external code must resolve in this tenant.",
            row.location_external_code,
          ),
        );
      }

      if (!locationExternalCode && locationName) {
        const matchCount = locationNameCounts.get(locationName) ?? 0;

        if (matchCount === 0) {
          issues.push(
            createIssue(
              rowNumber,
              "location_name",
              "error",
              "LOCATION_NOT_FOUND",
              "Location name must resolve in this tenant.",
              row.location_name,
            ),
          );
        } else if (matchCount > 1) {
          issues.push(
            createIssue(
              rowNumber,
              "location_name",
              "error",
              "LOCATION_AMBIGUOUS",
              "Location name resolves to more than one location.",
              row.location_name,
            ),
          );
        }
      }
    });

    return buildPreview(parsedFile, issues);
  }

  private async validateProductsPreview(
    prisma: PrismaService,
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const issues: ImportPreviewIssue[] = [];
    const externalCodeCounts = countNormalizedValues(
      parsedFile.rows,
      "external_code",
    );
    const existingProducts = await prisma.product.findMany({
      where: {
        tenantId: context.tenantId,
        externalCode: { in: [...externalCodeCounts.keys()] },
        deletedAt: null,
      },
      select: { externalCode: true },
    });
    const existingExternalCodes = new Set(
      existingProducts
        .map((product) => normalizeValue(product.externalCode))
        .filter(isPresent),
    );

    parsedFile.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      addRequiredIssues(issues, row, rowNumber, ["name"]);

      const externalCode = normalizeValue(row.external_code);

      if (externalCode && (externalCodeCounts.get(externalCode) ?? 0) > 1) {
        issues.push(
          createIssue(
            rowNumber,
            "external_code",
            "error",
            "DUPLICATE_EXTERNAL_CODE_IN_FILE",
            "External code is duplicated in this file.",
            row.external_code,
          ),
        );
      }

      if (externalCode && existingExternalCodes.has(externalCode)) {
        issues.push(
          createIssue(
            rowNumber,
            "external_code",
            "error",
            "EXTERNAL_CODE_ALREADY_EXISTS",
            "Product external code already exists in this tenant.",
            row.external_code,
          ),
        );
      }
    });

    return buildPreview(parsedFile, issues);
  }

  private async validateInitialPlanPreview(
    prisma: PrismaService,
    context: RequestContext,
    parsedFile: ParsedImportFile,
  ): Promise<ImportValidationPreview> {
    const issues: ImportPreviewIssue[] = [];
    const representativeEmails = collectNormalizedValues(
      parsedFile.rows,
      "representative_email",
    );
    const locationExternalCodes = collectNormalizedValues(
      parsedFile.rows,
      "location_external_code",
    );
    const locationNames = collectNormalizedValues(
      parsedFile.rows,
      "location_name",
    );
    const existingRepresentatives = await this.findExistingUsersByEmail(
      prisma,
      context.tenantId,
      [...representativeEmails],
      "field_representative",
    );
    const existingExternalCodes = await this.findExistingLocationExternalCodes(
      prisma,
      context.tenantId,
      [...locationExternalCodes],
    );
    const locationNameCounts = await this.countLocationsByName(
      prisma,
      context.tenantId,
      [...locationNames],
    );
    const sequenceCounts = countCompositeValues(parsedFile.rows, [
      "representative_email",
      "plan_date",
      "sequence",
    ]);

    parsedFile.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      addRequiredIssues(issues, row, rowNumber, [
        "representative_email",
        "plan_date",
      ]);

      const representativeEmail = normalizeValue(row.representative_email);

      if (
        representativeEmail &&
        !existingRepresentatives.has(representativeEmail)
      ) {
        issues.push(
          createIssue(
            rowNumber,
            "representative_email",
            "error",
            "REPRESENTATIVE_NOT_FOUND",
            "Representative must exist and have field role.",
            row.representative_email,
          ),
        );
      }

      const locationExternalCode = normalizeValue(row.location_external_code);
      const locationName = normalizeValue(row.location_name);

      if (!locationExternalCode && !locationName) {
        issues.push(
          createIssue(
            rowNumber,
            "location_external_code",
            "error",
            "LOCATION_REFERENCE_REQUIRED",
            "location_external_code or location_name is required.",
            "",
          ),
        );
      } else if (
        locationExternalCode &&
        !existingExternalCodes.has(locationExternalCode)
      ) {
        issues.push(
          createIssue(
            rowNumber,
            "location_external_code",
            "error",
            "LOCATION_NOT_FOUND",
            "Location external code must resolve in this tenant.",
            row.location_external_code,
          ),
        );
      } else if (!locationExternalCode && locationName) {
        const matchCount = locationNameCounts.get(locationName) ?? 0;

        if (matchCount === 0) {
          issues.push(
            createIssue(
              rowNumber,
              "location_name",
              "error",
              "LOCATION_NOT_FOUND",
              "Location name must resolve in this tenant.",
              row.location_name,
            ),
          );
        } else if (matchCount > 1) {
          issues.push(
            createIssue(
              rowNumber,
              "location_name",
              "error",
              "LOCATION_AMBIGUOUS",
              "Location name resolves to more than one location.",
              row.location_name,
            ),
          );
        }
      }

      addDateIssue(issues, row, rowNumber, "plan_date");
      addDateIssue(issues, row, rowNumber, "task_due_date");
      addTimeIssue(issues, row, rowNumber, "planned_start_time");
      addTimeIssue(issues, row, rowNumber, "planned_end_time");
      addTaskIsPriorityIssue(issues, row, rowNumber);

      const sequence = normalizeValue(row.sequence);
      const sequenceKey = compositeKey(row, [
        "representative_email",
        "plan_date",
        "sequence",
      ]);

      if (sequence && !/^\d+$/.test(sequence)) {
        issues.push(
          createIssue(
            rowNumber,
            "sequence",
            "error",
            "SEQUENCE_INVALID",
            "Sequence must be a positive integer.",
            row.sequence,
          ),
        );
      } else if (sequenceKey && (sequenceCounts.get(sequenceKey) ?? 0) > 1) {
        issues.push(
          createIssue(
            rowNumber,
            "sequence",
            "error",
            "DUPLICATE_SEQUENCE_IN_FILE",
            "Representative cannot have duplicate sequence for the same day.",
            row.sequence,
          ),
        );
      }
    });

    return buildPreview(parsedFile, issues);
  }

  private async getTenantPhoneCountry(
    prisma: PrismaService | PrismaTransaction,
    tenantId: string,
  ): Promise<string | null> {
    const tenant = await prisma.platformTenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { phoneCountry: true },
    });

    return tenant.phoneCountry;
  }

  private async findExistingLocationExternalCodes(
    prisma: PrismaService,
    tenantId: string,
    externalCodes: string[],
  ): Promise<Set<string>> {
    if (externalCodes.length === 0) {
      return new Set();
    }

    const locations = await prisma.location.findMany({
      where: {
        tenantId,
        externalCode: { in: externalCodes },
        deletedAt: null,
      },
      select: { externalCode: true },
    });

    return new Set(
      locations
        .map((location) => normalizeValue(location.externalCode))
        .filter(isPresent),
    );
  }

  private async findExistingLocationCategoryNames(
    prisma: PrismaService,
    tenantId: string,
    names: string[],
  ): Promise<Set<string>> {
    if (names.length === 0) {
      return new Set();
    }

    const categories = await prisma.locationCategory.findMany({
      where: {
        tenantId,
        name: { in: names, mode: "insensitive" },
      },
      select: { name: true },
    });

    return new Set(categories.map((category) => normalizeValue(category.name)));
  }

  private async findExistingUsersByEmail(
    prisma: PrismaService,
    tenantId: string,
    emails: string[],
    requiredRoleCode?: RoleCode,
  ): Promise<Set<string>> {
    if (emails.length === 0) {
      return new Set();
    }

    const users = await prisma.user.findMany({
      where: {
        tenantId,
        email: { in: emails },
        status: "active",
        deletedAt: null,
        roles: requiredRoleCode
          ? { some: { tenantId, roleCode: requiredRoleCode } }
          : undefined,
      },
      select: { email: true },
    });

    return new Set(users.map((user) => user.email));
  }

  private async countLocationsByName(
    prisma: PrismaService,
    tenantId: string,
    names: string[],
  ): Promise<Map<string, number>> {
    if (names.length === 0) {
      return new Map();
    }

    const locations = await prisma.location.findMany({
      where: {
        tenantId,
        name: { in: names },
        deletedAt: null,
      },
      select: { name: true },
    });

    return locations.reduce<Map<string, number>>((counts, location) => {
      const name = normalizeValue(location.name);
      counts.set(name, (counts.get(name) ?? 0) + 1);

      return counts;
    }, new Map());
  }

  private getPrisma(): PrismaService {
    if (!this.prisma) {
      throw new Error("Prisma service is required for import validation.");
    }

    return this.prisma;
  }
}

function parseStoredParsedFile(
  templateType: ImportTemplateType,
  summary: Prisma.JsonValue,
): ParsedImportFile {
  if (!isRecord(summary)) {
    throwStoredImportInvalid();
  }

  const columns = summary.columns;
  const rows = summary.rows;

  if (
    !Array.isArray(columns) ||
    !columns.every((column) => typeof column === "string")
  ) {
    throwStoredImportInvalid();
  }

  if (!Array.isArray(rows) || !rows.every(isStringRecord)) {
    throwStoredImportInvalid();
  }

  return {
    templateType,
    columns,
    rows,
  };
}

function readAppliedCounts(
  summary: Prisma.JsonValue,
): ImportApplyResult["createdCounts"] | null {
  if (!isRecord(summary) || !isRecord(summary.appliedCounts)) {
    return null;
  }

  return {
    users: readNumber(summary.appliedCounts.users),
    userRoles: readNumber(summary.appliedCounts.userRoles),
    chains: readNumber(summary.appliedCounts.chains),
    locationCategories: readNumber(summary.appliedCounts.locationCategories),
    locations: readNumber(summary.appliedCounts.locations),
    locationAssignments: readNumber(summary.appliedCounts.locationAssignments),
    contacts: readNumber(summary.appliedCounts.contacts),
    products: readNumber(summary.appliedCounts.products),
    routePlans: readNumber(summary.appliedCounts.routePlans),
    routeItems: readNumber(summary.appliedCounts.routeItems),
    tasks: readNumber(summary.appliedCounts.tasks),
  };
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function requiredString(value: string | undefined): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new BadRequestException({
      code: "IMPORT_STORED_ROW_INVALID",
      message: "Stored import row is missing a required value.",
    });
  }

  return normalizedValue;
}

function optionalString(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  return normalizedValue || null;
}

// Confirm-time counterpart of addPhoneIssue: validation already blocked bad
// phones, so stored rows normally parse. A stored file validated before phone
// validation existed falls back to the trimmed raw value rather than failing
// the whole confirm.
function optionalPhone(
  value: string | undefined,
  phoneCountry: string | null,
): string | null {
  const raw = optionalString(value);

  if (!raw) {
    return null;
  }

  const normalized = normalizePhoneInput(raw, phoneCountry);

  return normalized.ok ? normalized.e164 : raw;
}

function optionalNumber(value: string | undefined): number | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  return Number(normalizedValue);
}

function optionalPositiveInteger(value: string | undefined): number | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  return Number(normalizedValue);
}

function parseDateOnly(value: string | undefined): Date {
  const normalizedValue = requiredString(value);

  return new Date(`${normalizedValue}T00:00:00.000Z`);
}

function optionalPlanDateTime(
  dateValue: string | undefined,
  timeValue: string | undefined,
): Date | null {
  const normalizedTime = timeValue?.trim();

  if (!normalizedTime) {
    return null;
  }

  return new Date(`${requiredString(dateValue)}T${normalizedTime}:00.000Z`);
}

function parseTaskIsPriority(value: string | undefined): boolean {
  return normalizeValue(value) === "priority";
}

function throwStoredImportInvalid(): never {
  throw new BadRequestException({
    code: "IMPORT_STORED_SNAPSHOT_INVALID",
    message: "Stored import snapshot is invalid.",
  });
}

function throwImportReferenceNotFound(): never {
  throw new BadRequestException({
    code: "IMPORT_REFERENCE_NOT_FOUND",
    message: "Import reference no longer resolves in this tenant.",
  });
}

// The resolvers above throw for every reference they cannot resolve before any
// row is written, so a lookup in one of their maps always hits. This keeps that
// invariant checked rather than assumed — an unresolved reference must never
// reach a `createMany` as an undefined foreign key.
function requireReference(id: string | undefined): string {
  if (!id) {
    throwImportReferenceNotFound();
  }

  return id;
}

// Route plans are keyed by (representative, date) within one import, matching
// the partial unique index on template-less plans.
function routePlanKey(representativeUserId: string, planDate: Date): string {
  return `${representativeUserId}|${planDate.toISOString()}`;
}

function assertRowCountWithinLimit(rowCount: number): void {
  if (rowCount > MAX_IMPORT_ROWS) {
    throw new BadRequestException({
      code: "IMPORT_ROW_LIMIT_EXCEEDED",
      message: buildRowLimitMessage(rowCount),
    });
  }
}

function buildRowLimitMessage(rowCount: number): string {
  return `This file has ${rowCount} rows and an import accepts at most ${MAX_IMPORT_ROWS}. Split it into smaller files and upload them one after another.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is ParsedImportRow {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
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

// Mirrors apps/web/lib/csv.ts — same two rules, kept in step by
// tests/csv-formula-injection.test.ts. The formula guard is defence rather
// than a fix here: the only thing this file writes is the static column text
// of an import template, so nothing tenant-entered reaches it today. It is
// applied anyway, because "no dynamic column ever" is not a property anyone
// checks when adding a template.
export function escapeCsvCell(value: string): string {
  const guarded =
    /^[=+\-@\t\r]/.test(value) && !/^-?\d+(?:[.,]\d+)?$/.test(value)
      ? `'${value}`
      : value;

  if (!/[",\n\r]/.test(guarded)) {
    return guarded;
  }

  return `"${guarded.replaceAll('"', '""')}"`;
}

function buildPreview(
  parsedFile: ParsedImportFile,
  issues: ImportPreviewIssue[],
): ImportValidationPreview {
  // Applied here rather than in each of the five validators: a new template
  // gets the caps by declaring them on its columns, and cannot forget to call
  // anything.
  addLengthIssues(parsedFile, issues);
  addRowLimitIssues(parsedFile, issues);

  const errorRows = new Set(
    issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.rowNumber),
  );
  const warningRows = new Set(
    issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.rowNumber),
  );

  return {
    templateType: parsedFile.templateType,
    rowCount: parsedFile.rows.length,
    validRowCount: parsedFile.rows.length - errorRows.size,
    errorRowCount: errorRows.size,
    warningRowCount: warningRows.size,
    canConfirm: errorRows.size === 0,
    issues,
  };
}

/**
 * Caps every cell whose column declares a limit.
 *
 * The manual endpoints enforce the same caps in their `normalize*` helpers,
 * and the import path writes the same columns without them — so a scripted
 * caller could post a location name bounded only by the 100 kB body limit,
 * where `POST /locations` stops at 120 characters.
 *
 * An issue rather than a thrown error, because that is what the import flow
 * is: the person gets a row-and-column report of everything wrong with their
 * file, and a length problem belongs in it next to a malformed email rather
 * than failing the whole upload with one message.
 */
function addLengthIssues(
  parsedFile: ParsedImportFile,
  issues: ImportPreviewIssue[],
): void {
  const limitedColumns = getTemplateDefinition(
    parsedFile.templateType,
  ).columns.filter(
    (column): column is ImportTemplateColumn & { limit: TextLimitKey } =>
      column.limit !== undefined,
  );

  parsedFile.rows.forEach((row, index) => {
    for (const column of limitedColumns) {
      const value = normalizeValue(row[column.key]);
      const maximum = resolveLimit(column.limit);

      if (value.length > maximum) {
        issues.push(
          createIssue(
            index + 2,
            column.key,
            "error",
            "VALUE_TOO_LONG",
            `Value must be at most ${maximum} characters.`,
            row[column.key],
          ),
        );
      }
    }
  });
}

/**
 * Blocks a file that carries more rows than one import may apply.
 *
 * One issue per row past the cap rather than a single summary issue, so the
 * preview's own arithmetic stays true: `validRowCount` is then the number of
 * rows that would fit and `errorRowCount` the number that would have to move to
 * a second file, which is the decision the admin has to make. Every one of them
 * carries the same message naming both numbers, since only the first is
 * guaranteed to be read.
 *
 * The alternative — letting the file through and failing at confirm — is what
 * audit F8 recorded: an opaque 500 on the primary onboarding path, identical on
 * every retry, with nothing anywhere saying the file was too big.
 */
function addRowLimitIssues(
  parsedFile: ParsedImportFile,
  issues: ImportPreviewIssue[],
): void {
  if (parsedFile.rows.length <= MAX_IMPORT_ROWS) {
    return;
  }

  const message = buildRowLimitMessage(parsedFile.rows.length);

  for (
    let rowNumber = MAX_IMPORT_ROWS + 2;
    rowNumber <= parsedFile.rows.length + 1;
    rowNumber += 1
  ) {
    issues.push({
      rowNumber,
      severity: "error",
      code: "IMPORT_ROW_LIMIT_EXCEEDED",
      message,
    });
  }
}

function createIssue(
  rowNumber: number,
  fieldName: string,
  severity: "error" | "warning",
  code: string,
  message: string,
  rawValue: string | undefined,
): ImportPreviewIssue {
  return {
    rowNumber,
    fieldName,
    severity,
    code,
    message,
    rawValue,
  };
}

function addRequiredIssues(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldNames: readonly string[],
): void {
  for (const fieldName of fieldNames) {
    if (!normalizeValue(row[fieldName])) {
      issues.push(
        createIssue(
          rowNumber,
          fieldName,
          "error",
          "REQUIRED_FIELD_MISSING",
          "Required field is missing.",
          row[fieldName],
        ),
      );
    }
  }
}

function addEmailIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldName: string,
): void {
  const value = normalizeValue(row[fieldName]);

  if (value && !isValidEmail(value)) {
    issues.push(
      createIssue(
        rowNumber,
        fieldName,
        "error",
        "EMAIL_INVALID",
        "Email must be valid.",
        row[fieldName],
      ),
    );
  }
}

function addPhoneIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldName: string,
  phoneCountry: string | null,
): void {
  const value = normalizeValue(row[fieldName]);

  if (!value) {
    return;
  }

  const normalized = normalizePhoneInput(value, phoneCountry);

  if (!normalized.ok) {
    issues.push(
      createIssue(
        rowNumber,
        fieldName,
        "error",
        "PHONE_INVALID",
        normalized.reason === "country_required"
          ? "Phone must be in international format (+...)."
          : "Phone must be a valid phone number.",
        row[fieldName],
      ),
    );
  }
}

function addDecimalIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldName: string,
  min: number,
  max: number,
): void {
  const value = normalizeValue(row[fieldName]);

  if (!value) {
    return;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < min || parsedValue > max) {
    issues.push(
      createIssue(
        rowNumber,
        fieldName,
        "error",
        "DECIMAL_INVALID",
        `Value must be a number between ${min} and ${max}.`,
        row[fieldName],
      ),
    );
  }
}

function addDateIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldName: string,
): void {
  const value = normalizeValue(row[fieldName]);

  if (!value) {
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    issues.push(
      createIssue(
        rowNumber,
        fieldName,
        "error",
        "DATE_INVALID",
        "Date must use YYYY-MM-DD format.",
        row[fieldName],
      ),
    );
  }
}

function addTimeIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
  fieldName: string,
): void {
  const value = normalizeValue(row[fieldName]);

  if (!value) {
    return;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    issues.push(
      createIssue(
        rowNumber,
        fieldName,
        "error",
        "TIME_INVALID",
        "Time must use HH:mm format.",
        row[fieldName],
      ),
    );
  }
}

function addTaskIsPriorityIssue(
  issues: ImportPreviewIssue[],
  row: ParsedImportRow,
  rowNumber: number,
): void {
  const value = normalizeValue(row.task_priority);

  if (!value) {
    return;
  }

  if (value !== "normal" && value !== "priority") {
    issues.push(
      createIssue(
        rowNumber,
        "task_priority",
        "error",
        "TASK_PRIORITY_INVALID",
        "Task priority must be normal or priority.",
        row.task_priority,
      ),
    );
  }
}

function countNormalizedValues(
  rows: readonly ParsedImportRow[],
  fieldName: string,
): Map<string, number> {
  return rows.reduce<Map<string, number>>((counts, row) => {
    const value = normalizeValue(row[fieldName]);

    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return counts;
  }, new Map());
}

function collectNormalizedValues(
  rows: readonly ParsedImportRow[],
  fieldName: string,
): Set<string> {
  return new Set(
    rows.map((row) => normalizeValue(row[fieldName])).filter(isPresent),
  );
}

function countCompositeValues(
  rows: readonly ParsedImportRow[],
  fieldNames: readonly string[],
): Map<string, number> {
  return rows.reduce<Map<string, number>>((counts, row) => {
    const key = compositeKey(row, fieldNames);

    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return counts;
  }, new Map());
}

function compositeKey(
  row: ParsedImportRow,
  fieldNames: readonly string[],
): string | null {
  const values = fieldNames.map((fieldName) => normalizeValue(row[fieldName]));

  if (values.some((value) => !value)) {
    return null;
  }

  return values.join("\u001f");
}

function normalizeValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPresent(value: string): value is string {
  return value !== "";
}

function parseRoleCodes(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((roleCode) => roleCode.trim())
      .filter(Boolean) ?? []
  );
}

function isTenantRoleCode(roleCode: string): roleCode is RoleCode {
  return (
    roleCode === "company_admin" ||
    roleCode === "team_manager" ||
    roleCode === "field_representative"
  );
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
