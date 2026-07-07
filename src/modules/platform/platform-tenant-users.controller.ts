import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  PlatformInviteTenantUserInput,
  PlatformUpdateTenantAdminStatusInput,
} from "./platform.types";

@Controller("platform/tenants/:tenantId/users")
@UseGuards(PermissionGuard)
export class PlatformTenantUsersController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  listUsers(@Param("tenantId") tenantId: string) {
    return this.platformService.listTenantUsers(tenantId);
  }

  @Post("invite")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  inviteUser(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body()
    body: Omit<PlatformInviteTenantUserInput, "actorUserId" | "requestId">,
  ) {
    return this.platformService.inviteTenantUser(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Patch(":userId/status")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  updateAdminStatus(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Param("userId") userId: string,
    @Body()
    body: Omit<
      PlatformUpdateTenantAdminStatusInput,
      "actorUserId" | "requestId"
    >,
  ) {
    return this.platformService.updateTenantAdminStatus(tenantId, userId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }
}
