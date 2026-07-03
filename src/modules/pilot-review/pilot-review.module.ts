import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { PilotReviewController } from "./pilot-review.controller";
import { PilotReviewService } from "./pilot-review.service";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PilotReviewController],
  providers: [PilotReviewService],
})
export class PilotReviewModule {}
