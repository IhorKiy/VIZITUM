import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { getRequestContext } from "../tenancy/request-context";
import { LocationInsightsSummaryService } from "./location-insights-summary.service";

@Controller("location-insights")
@UseGuards(PermissionGuard)
export class LocationInsightsSummaryController {
  constructor(
    private readonly locationInsightsSummaryService: LocationInsightsSummaryService,
  ) {}

  @Get("summary")
  @RequirePermissions(PERMISSIONS.LOCATION_INSIGHTS_READ)
  getSummary(@Req() request: Request) {
    return this.locationInsightsSummaryService.getSummary(
      getRequestContext(request),
    );
  }
}
