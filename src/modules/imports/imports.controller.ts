import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { ImportsService } from "./imports.service";

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
}
