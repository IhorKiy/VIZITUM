import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformSessionService } from "./platform-session.service";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { ProvisioningService } from "./provisioning.service";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController, PlatformAuthController],
  providers: [
    PlatformService,
    ProvisioningService,
    PlatformAuthService,
    PlatformSessionService,
  ],
  exports: [PlatformService, ProvisioningService],
})
export class PlatformModule {}
