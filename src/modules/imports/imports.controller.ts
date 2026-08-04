import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { CreateImportValidationJobDto } from "./imports.dto";
import { ImportsService } from "./imports.service";
import {
  IMPORT_TEMPLATE_TYPES,
  type ImportTemplateType,
} from "./imports.types";

@Controller("imports")
@UseGuards(PermissionGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get("templates")
  @RequirePermissions(PERMISSIONS.IMPORTS_READ)
  listTemplates() {
    return this.importsService.listTemplates();
  }

  @Get("templates/:templateFile")
  @RequirePermissions(PERMISSIONS.IMPORTS_READ)
  downloadTemplate(
    @Param("templateFile") templateFile: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const template = this.importsService.getTemplateCsv(templateFile);

    response.setHeader("Content-Type", template.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${template.fileName}"`,
    );

    return template.body;
  }

  @Post("jobs/validate")
  @RequirePermissions(PERMISSIONS.IMPORTS_UPLOAD)
  // Tier 5 of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global, and
  // narrower than it looks: see docs/plans/imports-dto-migration-note.md for
  // what it does *not* buy. The three parsers below run unchanged behind it.
  @UsePipes(createStrictValidationPipe())
  createValidationJob(
    @Req() request: Request,
    @Body() body: CreateImportValidationJobDto,
  ) {
    const templateType = parseImportTemplateType(body.templateType);
    const csvText = parseCsvText(body.csvText);
    const sourceFileName = parseFileName(body.fileName);
    const parsedFile = this.importsService.parseApprovedCsvTemplate(
      templateType,
      csvText,
    );

    return this.importsService.createImportValidationJob(
      getRequestContext(request),
      parsedFile,
      { sourceFileName },
    );
  }

  @Get("jobs")
  @RequirePermissions(PERMISSIONS.IMPORTS_READ)
  listImportJobs(@Req() request: Request) {
    return this.importsService.listImportJobs(getRequestContext(request));
  }

  @Get("jobs/:importJobId")
  @RequirePermissions(PERMISSIONS.IMPORTS_READ)
  getValidationJob(
    @Req() request: Request,
    @Param("importJobId") importJobId: string,
  ) {
    return this.importsService.getImportValidationJob(
      getRequestContext(request),
      importJobId,
    );
  }

  @Post("jobs/:importJobId/confirm")
  @RequirePermissions(PERMISSIONS.IMPORTS_CONFIRM)
  confirmImportJob(
    @Req() request: Request,
    @Param("importJobId") importJobId: string,
  ) {
    return this.importsService.confirmImportJob(
      getRequestContext(request),
      importJobId,
    );
  }
}

function parseImportTemplateType(value: unknown): ImportTemplateType {
  const templateType = IMPORT_TEMPLATE_TYPES.find((type) => type === value);

  if (templateType) {
    return templateType;
  }

  throw new BadRequestException({
    code: "IMPORT_TEMPLATE_INVALID",
    message: "Import template type is required.",
    fieldErrors: {
      templateType: ["Import template type is required."],
    },
  });
}

function parseCsvText(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new BadRequestException({
    code: "IMPORT_FILE_INVALID",
    message: "CSV file content is required.",
    fieldErrors: {
      csvText: ["CSV file content is required."],
    },
  });
}

function parseFileName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  // Keep the original name for display, but cap it so an oversized client value
  // can't bloat the row; the column is nullable and purely informational.
  return trimmed ? trimmed.slice(0, 255) : undefined;
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
