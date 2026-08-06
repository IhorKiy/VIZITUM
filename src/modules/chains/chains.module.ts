import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { ChainsController } from "./chains.controller";
import { ChainsService } from "./chains.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [ChainsController],
  providers: [ChainsService],
  exports: [ChainsService],
})
export class ChainsModule {}
