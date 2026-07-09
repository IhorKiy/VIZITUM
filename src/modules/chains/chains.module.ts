import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ChainsController } from "./chains.controller";
import { ChainsService } from "./chains.service";

@Module({
  imports: [AuthModule],
  controllers: [ChainsController],
  providers: [ChainsService],
  exports: [ChainsService],
})
export class ChainsModule {}
