import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";

import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { AuditService } from "../audit/audit.service";
import { PermissionGuard } from "../auth/permission.guard";
import {
  RequireAnyPermissions,
  RequirePermissions,
} from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import type { RequestContext } from "../tenancy/request-context";
import { RecordDashboardViewDto } from "./pilot-review.dto";
import {
  MANAGER_DASHBOARD_VIEWED_EVENT_TYPE,
  PilotReviewService,
} from "./pilot-review.service";
import {
  DASHBOARD_VIEW_PAGES,
  type DashboardViewPage,
} from "./pilot-review.types";

@Controller("pilot-review")
@UseGuards(PermissionGuard)
export class PilotReviewController {
  constructor(
    private readonly pilotReviewService: PilotReviewService,
    private readonly auditService: AuditService,
  ) {}

  @Get("summary")
  @RequirePermissions(PERMISSIONS.PILOT_REVIEW_READ)
  getSummary(@Req() request: Request) {
    return this.pilotReviewService.getSummary(getRequestContext(request));
  }

  @Post("dashboard-views")
  @RequireAnyPermissions(
    PERMISSIONS.DASHBOARD_MANAGER_READ,
    PERMISSIONS.PILOT_REVIEW_READ,
  )
  // Next module on the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route only, not a
  // global ValidationPipe.
  @UsePipes(createStrictValidationPipe())
  async recordDashboardView(
    @Req() request: Request,
    @Body() body: RecordDashboardViewDto,
  ): Promise<{ recorded: true }> {
    const context = getRequestContext(request);
    const page = normalizeDashboardViewPage(body.page);

    await this.auditService.recordEvent(context, {
      entityType: "manager_dashboard",
      entityId: context.userId ?? "unknown",
      eventType: MANAGER_DASHBOARD_VIEWED_EVENT_TYPE,
      metadata: { page },
    });

    return { recorded: true };
  }
}

function getRequestContext(request: Request): RequestContext {
  if (!request.context) {
    throw new Error("Request context was not initialized.");
  }

  return request.context;
}

function normalizeDashboardViewPage(value: unknown): DashboardViewPage {
  if (
    typeof value === "string" &&
    (DASHBOARD_VIEW_PAGES as readonly string[]).includes(value)
  ) {
    return value as DashboardViewPage;
  }

  throw new BadRequestException({
    code: "DASHBOARD_VIEW_PAGE_INVALID",
    message: `page must be one of: ${DASHBOARD_VIEW_PAGES.join(", ")}.`,
  });
}
