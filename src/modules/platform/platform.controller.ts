import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { describeRequestOrigin } from "../../common/request-origin";
import { createStrictValidationPipe } from "../../common/strict-validation-pipe";
import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PLATFORM_REAUTH_THROTTLE } from "../rate-limit/rate-limit.constants";
import { PERMISSIONS } from "../roles/permissions";
import {
  CreateTenantDto,
  RequestTenantPurgeDto,
  UpdateTenantDto,
} from "./platform.dto";
import { PlatformService } from "./platform.service";

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
  // Tier 4 (administrative surfaces) of the class-validator DTO track (2.4 in
  // docs/security-remediation-plan.md) — scoped to this route, not global.
  // The pipe also closes the `...body` spread below: `actorUserId` and
  // `requestId` are read from the request, and a body carrying either is now
  // refused rather than overwritten.
  @UsePipes(createStrictValidationPipe())
  createTenant(@Req() request: Request, @Body() body: CreateTenantDto) {
    return this.platformService.createTenant({
      ...body,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
    });
  }

  @Patch(":tenantId")
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  updateTenant(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: UpdateTenantDto,
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

  // Tighter than any login throttle: this is reached from an authenticated
  // session and nothing legitimate retries it in a loop.
  @Post(":tenantId/purge")
  @Throttle({
    default: {
      limit: PLATFORM_REAUTH_THROTTLE.limit,
      ttl: PLATFORM_REAUTH_THROTTLE.ttlSeconds * 1_000,
    },
  })
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_MANAGE)
  @UsePipes(createStrictValidationPipe())
  requestTenantPurge(
    @Req() request: Request,
    @Param("tenantId") tenantId: string,
    @Body() body: RequestTenantPurgeDto,
  ) {
    return this.platformService.requestTenantPurge(tenantId, {
      confirmSlug: body?.confirmSlug,
      mfaCode: body?.mfaCode,
      actorUserId: request.context?.userId,
      requestId: request.requestId,
      origin: describeRequestOrigin(request),
    });
  }
}
