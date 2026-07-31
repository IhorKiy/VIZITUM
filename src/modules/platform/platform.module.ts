import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformMfaService } from "./platform-mfa.service";
import { PlatformSessionService } from "./platform-session.service";
import { PlatformTenantSuperadminController } from "./platform-tenant-superadmin.controller";
import { PlatformTenantUsersController } from "./platform-tenant-users.controller";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { TenantPurgeService } from "./tenant-purge.service";

@Module({
  imports: [AuthModule, UsersModule, AuditModule, StorageModule],
  controllers: [
    PlatformController,
    PlatformAuthController,
    PlatformTenantUsersController,
    PlatformTenantSuperadminController,
  ],
  providers: [
    PlatformService,
    PlatformAuthService,
    PlatformMfaService,
    PlatformSessionService,
    TenantPurgeService,
  ],
  exports: [PlatformService, TenantPurgeService],
})
export class PlatformModule {}
