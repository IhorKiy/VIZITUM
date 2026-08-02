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
  CreateTenantInput,
  PlatformRequestPurgeInput,
  UpdateTenantInput,
} from "./platform.types";

@Controller("platform/tenants")
@UseGuards(PermissionGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  listTenants() {
    return this.platformService.listTenants();
  }

  @Get(":tenantId")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  getTenant(@Param("tenantId") tenantId: string) {
    return this.platformService.getTenant(tenantId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  createTenant(
    @Req() request: Request,
    @Body() body: Omit<CreateTenantInput, "actorUserId" | "requestId">,
  ) {
    return this.platformService.createTenant({
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Patch(":tenantId")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  updateTenant(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: Omit<UpdateTenantInput, "actorUserId" | "requestId">,
  ) {
    return this.platformService.updateTenant(tenantId, {
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Post(":tenantId/archive")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  archiveTenant(@Req() request: Request, @Param("tenantId") tenantId: string) {
    return this.platformService.archiveTenant(tenantId, {
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Post(":tenantId/unarchive")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  unarchiveTenant(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
  ) {
    return this.platformService.unarchiveTenant(tenantId, {
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Post(":tenantId/purge")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  requestTenantPurge(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: Pick<PlatformRequestPurgeInput, "confirmSlug" | "mfaCode">,
  ) {
    return this.platformService.requestTenantPurge(tenantId, {
      confirmSlug: body?.confirmSlug,
      mfaCode: body?.mfaCode,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }
}
