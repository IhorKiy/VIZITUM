import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { SettingsService } from "./settings.service";
import type { UpdateTenantSettingsRequestBody } from "./settings.types";

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
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
