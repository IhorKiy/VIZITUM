import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import {
  ConfirmLogoUploadDto,
  RegisterLogoUploadDto,
  UpdateTenantSettingsDto,
} from "./settings.dto";
import { SettingsService } from "./settings.service";

@Controller("admin/settings")
@UseGuards(PermissionGuard)
export class AdminSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_READ)
  getSettings(@Req() request: Request) {
    return this.settingsService.getSettings(getRequestContext(request));
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  // Tier 4 (administrative surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  updateSettings(
    @Req() request: Request,
    @Body() body: UpdateTenantSettingsDto,
  ) {
    return this.settingsService.updateSettings(
      getRequestContext(request),
      body,
    );
  }

  @Post("logo/register")
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  registerLogoUpload(
    @Req() request: Request,
    @Body() body: RegisterLogoUploadDto,
  ) {
    return this.settingsService.registerLogoUpload(
      getRequestContext(request),
      body,
    );
  }

  @Post("logo/confirm")
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  confirmLogoUpload(
    @Req() request: Request,
    @Body() body: ConfirmLogoUploadDto,
  ) {
    return this.settingsService.confirmLogoUpload(
      getRequestContext(request),
      body,
    );
  }

  @Delete("logo")
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  removeLogo(@Req() request: Request) {
    return this.settingsService.removeLogo(getRequestContext(request));
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
