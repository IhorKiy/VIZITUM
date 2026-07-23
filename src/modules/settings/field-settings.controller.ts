import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { SettingsService } from "./settings.service";

// Read-only settings surface for the field zone: the visit-report screen
// shows the tenant's voice hint, and field reps don't (and shouldn't) hold
// tenant_settings.read — gate on the permission that lets them file reports.
@Controller("settings")
@UseGuards(PermissionGuard)
export class FieldSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("field-report-voice-hint")
  @RequirePermissions(PERMISSIONS.VISITS_CREATE)
  getFieldReportVoiceHint(@Req() request: Request) {
    return this.settingsService.getFieldReportVoiceHint(
      getRequestContext(request),
    );
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}
