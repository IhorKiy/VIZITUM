import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformSessionService } from "./platform-session.service";
import { PlatformTenantSuperadminController } from "./platform-tenant-superadmin.controller";
import { PlatformTenantUsersController } from "./platform-tenant-users.controller";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

@Module({
  imports: [AuthModule, UsersModule, AuditModule],
  controllers: [
    PlatformController,
    PlatformAuthController,
    PlatformTenantUsersController,
    PlatformTenantSuperadminController,
  ],
  providers: [PlatformService, PlatformAuthService, PlatformSessionService],
  exports: [PlatformService],
})
export class PlatformModule {}
