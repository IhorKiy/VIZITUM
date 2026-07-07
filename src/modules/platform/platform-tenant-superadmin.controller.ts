import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { PlatformService } from "./platform.service";
import type {
  PlatformInviteSuperadminInput,
  PlatformPromoteSuperadminInput,
} from "./platform.types";

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
  inviteOrReplaceSuperadmin(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body()
    body: Omit<PlatformInviteSuperadminInput, "actorUserId" | "requestId">,
  ) {
    return this.platformService.inviteOrReplaceTenantSuperadmin(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Post("promote")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  promoteToSuperadmin(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body()
    body: Omit<PlatformPromoteSuperadminInput, "actorUserId" | "requestId">,
  ) {
    return this.platformService.promoteToSuperadmin(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }
}
