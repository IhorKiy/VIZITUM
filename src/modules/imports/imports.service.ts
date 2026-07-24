import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma, RoleCode } from "@prisma/client";
import { execFileSync } from "node:child_process";

import { normalizePhoneInput } from "../../common/phone";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../tenancy/request-context";
import type {
  CreateImportValidationJobOptions,
  ImportApplyResult,
  ImportJobHistoryItem,
  ImportPreviewIssue,
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

type ImportCreatedCounts = ImportApplyResult["createdCounts"];
type PrismaTransaction = Prisma.TransactionClient;

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
      "phone must be a valid national or +international number if provided",
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
      {
        key: "category",
        required: false,
        description:
          "Optional category name from the tenant's location category dictionary; unresolved names are created automatically on confirm.",
      },
      {
        key: "chain",
        required: false,
        description:
          "Optional retail chain/network name; created on first use and reused by name.",
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
        description:
          "Fallback location reference when external code is absent.",
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
      "phone must be a valid national or +international number if provided",
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
        description:
          "Fallback location reference when external code is absent.",
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
        description: "Optional task priority: normal or priority.",
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
    const createdCounts = await prisma.$transaction(async (transaction) => {
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
    });

    return {
      importJobId: importJob.id,
      status: "applied",
      appliedRowCount: parsedFile.rows.length,
      createdCounts,
    };
  }

  private async applyUsersImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    const phoneCountry = await this.getTenantPhoneCountry(
      transaction,
      context.tenantId,
    );

    for (const row of parsedFile.rows) {
      const roleCodes = parseRoleCodes(row.roles).filter(isTenantRoleCode);
      const user = await transaction.user.create({
        data: {
          tenantId: context.tenantId,
          email: normalizeValue(row.email),
          name: requiredString(row.name),
          phone: optionalPhone(row.phone, phoneCountry),
          status: "invited",
        },
        select: { id: true },
      });

      counts.users += 1;

      if (roleCodes.length > 0) {
        await transaction.userRole.createMany({
          data: roleCodes.map((roleCode) => ({
            tenantId: context.tenantId,
            userId: user.id,
            roleCode,
            assignedByUserId: context.userId,
          })),
        });
        counts.userRoles += roleCodes.length;
      }
    }
  }

  private async applyLocationsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    for (const row of parsedFile.rows) {
      const chainId = await this.resolveChainReference(
        transaction,
        context,
        row.chain,
        counts,
      );
      const categoryId = await this.resolveLocationCategoryReference(
        transaction,
        context,
        row.category,
        counts,
      );

      const location = await transaction.location.create({
        data: {
          tenantId: context.tenantId,
          chainId,
          categoryId,
          externalCode: optionalString(row.external_code),
          name: requiredString(row.name),
          addressLine: requiredString(row.address_line),
          city: requiredString(row.city),
          latitude: optionalNumber(row.latitude),
          longitude: optionalNumber(row.longitude),
          notes: optionalString(row.notes),
        },
        select: { id: true },
      });

      counts.locations += 1;

      const representativeEmail = normalizeValue(
        row.assigned_representative_email,
      );

      if (representativeEmail) {
        const representative = await this.findExistingUserByEmailOrThrow(
          transaction,
          context.tenantId,
          representativeEmail,
        );

        await transaction.locationAssignment.create({
          data: {
            tenantId: context.tenantId,
            locationId: location.id,
            representativeUserId: representative.id,
            assignedByUserId: context.userId,
            status: "active",
          },
        });
        counts.locationAssignments += 1;
      }
    }
  }

  private async applyContactsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    const phoneCountry = await this.getTenantPhoneCountry(
      transaction,
      context.tenantId,
    );

    for (const row of parsedFile.rows) {
      const location = await this.resolveLocationReference(
        transaction,
        context.tenantId,
        row.location_external_code,
        row.location_name,
      );

      await transaction.locationContact.create({
        data: {
          tenantId: context.tenantId,
          locationId: location.id,
          name: requiredString(row.name),
          roleTitle: optionalString(row.role_title),
          phone: optionalPhone(row.phone, phoneCountry),
          email: optionalString(row.email),
          notes: optionalString(row.notes),
        },
      });
      counts.contacts += 1;
    }
  }

  private async applyProductsImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    for (const row of parsedFile.rows) {
      await transaction.product.create({
        data: {
          tenantId: context.tenantId,
          externalCode: optionalString(row.external_code),
          name: requiredString(row.name),
          sku: optionalString(row.sku),
          category: optionalString(row.category),
        },
      });
      counts.products += 1;
    }
  }

  private async applyInitialPlanImport(
    transaction: PrismaTransaction,
    context: RequestContext,
    parsedFile: ParsedImportFile,
    counts: ImportCreatedCounts,
  ): Promise<void> {
    for (const row of parsedFile.rows) {
      const representative = await this.findExistingUserByEmailOrThrow(
        transaction,
        context.tenantId,
        normalizeValue(row.representative_email),
        "field_representative",
      );
      const location = await this.resolveLocationReference(
        transaction,
        context.tenantId,
        row.location_external_code,
        row.location_name,
      );
      const planDate = parseDateOnly(row.plan_date);
      // Imported plans are always template-less, so they fall under the
      // partial unique index scoped to routeTemplateId IS NULL
      // (route_plans_rep_date_no_template_key) — the compound
      // tenantId_representativeUserId_planDate key this used to look up no
      // longer exists now that a representative can hold several
      // template-based plans on the same day (see the
      // 20260721062916_route_plan_multi_per_day migration).
      const existingPlan = await transaction.routePlan.findFirst({
        where: {
          tenantId: context.tenantId,
          representativeUserId: representative.id,
          planDate,
          routeTemplateId: null,
        },
        select: { id: true },
      });
      const routePlan =
        existingPlan ??
        (await transaction.routePlan.create({
          data: {
            tenantId: context.tenantId,
            representativeUserId: representative.id,
            planDate,
            createdByUserId: context.userId,
          },
          select: { id: true },
        }));

      if (!existingPlan) {
        counts.routePlans += 1;
      }

      const sequence =
        optionalPositiveInteger(row.sequence) ??
        (await transaction.routeItem.count({
          where: {
            tenantId: context.tenantId,
            routePlanId: routePlan.id,
          },
        })) + 1;

      await transaction.routeItem.create({
        data: {
          tenantId: context.tenantId,
          routePlanId: routePlan.id,
          locationId: location.id,
          sequence,
          plannedStartTime: optionalPlanDateTime(
            row.plan_date,
            row.planned_start_time,
          ),
          plannedEndTime: optionalPlanDateTime(
            row.plan_date,
            row.planned_end_time,
          ),
        },
        select: { id: true },
      });

      counts.routeItems += 1;

      const taskTitle = optionalString(row.task_title);

      if (taskTitle) {
        await transaction.task.create({
          data: {
            tenantId: context.tenantId,
            title: taskTitle,
            isPriority: parseTaskIsPriority(row.task_priority),
            assignedToUserId: representative.id,
            createdByUserId: context.userId,
            locationId: location.id,
            dueDate: row.task_due_date
              ? parseDateOnly(row.task_due_date)
              : null,
          },
        });
        counts.tasks += 1;
      }
    }
  }

  private async findExistingUserByEmailOrThrow(
    transaction: PrismaTransaction,
    tenantId: string,
    email: string,
    requiredRoleCode?: RoleCode,
  ): Promise<{ id: string }> {
    const user = await transaction.user.findFirst({
      where: {
        tenantId,
        email,
        status: "active",
        deletedAt: null,
        roles: requiredRoleCode
          ? { some: { tenantId, roleCode: requiredRoleCode } }
          : undefined,
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException({
        code: "IMPORT_REFERENCE_NOT_FOUND",
        message: "Import reference no longer resolves in this tenant.",
      });
    }

    return user;
  }

  // Resolve a chain by name for a location import row, creating it on first
  // use so a chain column can populate the canonical list without a separate
  // upload. Matching is case-insensitive to avoid duplicating an existing
  // chain that differs only in casing. Returns null when no chain is given.
  private async resolveChainReference(
    transaction: PrismaTransaction,
    context: RequestContext,
    nameInput: string | undefined,
    counts: ImportCreatedCounts,
  ): Promise<string | null> {
    const name = normalizeValue(nameInput);

    if (!name) {
      return null;
    }

    const existingChain = await transaction.chain.findFirst({
      where: {
        tenantId: context.tenantId,
        name: { equals: name, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existingChain) {
      return existingChain.id;
    }

    const chain = await transaction.chain.create({
      data: {
        tenantId: context.tenantId,
        name,
      },
      select: { id: true },
    });
    counts.chains += 1;

    return chain.id;
  }

  // Resolve a location category by name for a location import row, creating
  // it in the tenant's dictionary on first use — an import is run by an
  // admin, so authorship of the auto-created category stays with them. The
  // lookup is case-insensitive, so repeated or case-variant names within the
  // same file collapse onto one category (each row's lookup already sees
  // prior rows' inserts within this transaction), but unlike
  // `resolveChainReference`, the display name is stored exactly as typed —
  // matching the "stored exactly as typed" rule the rest of the category
  // dictionary follows (manual create/rename, migration backfill). Returns
  // null when no category is given.
  private async resolveLocationCategoryReference(
    transaction: PrismaTransaction,
    context: RequestContext,
    nameInput: string | undefined,
    counts: ImportCreatedCounts,
  ): Promise<string | null> {
    const name = optionalString(nameInput);

    if (!name) {
      return null;
    }

    const existingCategory = await transaction.locationCategory.findFirst({
      where: {
        tenantId: context.tenantId,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (existingCategory) {
      return existingCategory.id;
    }

    const category = await transaction.locationCategory.create({
      data: {
        tenantId: context.tenantId,
        name,
      },
      select: { id: true },
    });
    counts.locationCategories += 1;

    return category.id;
  }

  private async resolveLocationReference(
    transaction: PrismaTransaction,
    tenantId: string,
    externalCodeInput: string | undefined,
    nameInput: string | undefined,
  ): Promise<{ id: string }> {
    const externalCode = normalizeValue(externalCodeInput);

    if (externalCode) {
      const location = await transaction.location.findFirst({
        where: {
          tenantId,
          externalCode,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!location) {
        throwImportReferenceNotFound();
      }

      return location;
    }

    const name = normalizeValue(nameInput);
    const locations = await transaction.location.findMany({
      where: {
        tenantId,
        name,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (locations.length !== 1 || !locations[0]) {
      throwImportReferenceNotFound();
    }

    return locations[0];
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
      addRequiredIssues(issues, row, rowNumber, ["email", "name", "roles"]);
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

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function buildPreview(
  parsedFile: ParsedImportFile,
  issues: ImportPreviewIssue[],
): ImportValidationPreview {
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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
