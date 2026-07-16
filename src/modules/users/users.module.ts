import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { EmailModule } from "../email/email.module";
import { AdminUsersController } from "./admin-users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, AuditModule, EmailModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
