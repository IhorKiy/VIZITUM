import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import { PermissionGuard } from "../auth/permission.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import { PERMISSIONS } from "../roles/permissions";
import { PlatformService } from "./platform.service";

@Controller("platform/tenants/:tenantId/users")
@UseGuards(PermissionGuard)
export class PlatformTenantUsersController {
  constructor(private readonly platformService: PlatformService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLATFORM_TENANTS_READ)
  listUsers(@Param("tenantId") tenantId: string) {
    return this.platformService.listTenantUsers(tenantId);
  }
}
