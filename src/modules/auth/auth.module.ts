import { Module } from "@nestjs/common";

import { RolesModule } from "../roles/roles.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { PermissionGuard } from "./permission.guard";
import { SessionService } from "./session.service";

@Module({
  imports: [RolesModule, TenancyModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, PermissionGuard, SessionService],
  exports: [AuthService, PasswordService, PermissionGuard, SessionService],
})
export class AuthModule {}
