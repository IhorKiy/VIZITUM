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
} from "@nestjs/common";
import type { Request, Response } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { ImportsService } from "./imports.service";
import type {
  CreateImportValidationJobRequestBody,
  ImportTemplateType,
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
  createValidationJob(
    @Req() request: Request,
    @Body() body: CreateImportValidationJobRequestBody,
  ) {
    const templateType = parseImportTemplateType(body.templateType);
    const csvText = parseCsvText(body.csvText);
    const parsedFile = this.importsService.parseApprovedCsvTemplate(
      templateType,
      csvText,
    );

    return this.importsService.createImportValidationJob(
      getRequestContext(request),
      parsedFile,
    );
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
  if (
    value === "users" ||
    value === "locations" ||
    value === "contacts" ||
    value === "products" ||
    value === "initial_visit_task_plan"
  ) {
    return value;
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

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
