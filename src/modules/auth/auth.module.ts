import { Module } from "@nestjs/common";

import { EmailModule } from "../email/email.module";
import { RolesModule } from "../roles/roles.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { AuthAuditService } from "./auth-audit.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordResetService } from "./password-reset.service";
import { PasswordController } from "./password.controller";
import { PasswordService } from "./password.service";
import { PermissionGuard } from "./permission.guard";
import { SessionService } from "./session.service";
import { TurnstileService } from "./turnstile.service";

@Module({
  imports: [EmailModule, RolesModule, TenancyModule],
  controllers: [AuthController, PasswordController],
  providers: [
    AuthAuditService,
    AuthService,
    PasswordResetService,
    PasswordService,
    PermissionGuard,
    SessionService,
    TurnstileService,
  ],
  exports: [
    AuthAuditService,
    AuthService,
    PasswordResetService,
    PasswordService,
    PermissionGuard,
    SessionService,
    TurnstileService,
    RolesModule,
  ],
})
export class AuthModule {}
