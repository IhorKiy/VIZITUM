import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformSessionService } from "./platform-session.service";
import { PlatformTenantUsersController } from "./platform-tenant-users.controller";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [
    PlatformController,
    PlatformAuthController,
    PlatformTenantUsersController,
  ],
  providers: [PlatformService, PlatformAuthService, PlatformSessionService],
  exports: [PlatformService],
})
export class PlatformModule {}
