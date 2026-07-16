import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { SettingsService } from "./settings.service";
import type {
  ConfirmLogoUploadRequestBody,
  RegisterLogoUploadRequestBody,
  UpdateTenantSettingsRequestBody,
} from "./settings.types";

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
  updateSettings(
    @Req() request: Request,
    @Body() body: UpdateTenantSettingsRequestBody,
  ) {
    return this.settingsService.updateSettings(
      getRequestContext(request),
      body,
    );
  }

  @Post("logo/register")
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  registerLogoUpload(
    @Req() request: Request,
    @Body() body: RegisterLogoUploadRequestBody,
  ) {
    return this.settingsService.registerLogoUpload(
      getRequestContext(request),
      body,
    );
  }

  @Post("logo/confirm")
  @RequirePermissions(PERMISSIONS.TENANT_SETTINGS_MANAGE)
  confirmLogoUpload(
    @Req() request: Request,
    @Body() body: ConfirmLogoUploadRequestBody,
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
