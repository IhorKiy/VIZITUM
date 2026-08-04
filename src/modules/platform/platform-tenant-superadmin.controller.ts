import {
  Body,
  Controller,
  Get,
  Param,
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
import {
  InviteTenantSuperadminDto,
  PromoteTenantSuperadminDto,
} from "./platform.dto";
import { PlatformService } from "./platform.service";

@Controller("platform/tenants/:tenantId/superadmin")
@UseGuards(PermissionGuard)
export class PlatformTenantSuperadminController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  getSuperadmin(@Param("tenantId") tenantId: string) {
    return this.platformService.getTenantSuperadmin(tenantId);
  }

  @Post("invite")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  // Tier 4 (administrative surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  @UsePipes(createStrictValidationPipe())
  inviteOrReplaceSuperadmin(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: InviteTenantSuperadminDto,
  ) {
    return this.platformService.inviteOrReplaceTenantSuperadmin(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Post("promote")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  promoteToSuperadmin(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: PromoteTenantSuperadminDto,
  ) {
    return this.platformService.promoteToSuperadmin(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }
}
