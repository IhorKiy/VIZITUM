import { Module } from "@nestjs/common";

import { EmailConfigService } from "./email.config";
import { EmailService } from "./email.service";

@Module({
  providers: [EmailService, EmailConfigService],
  exports: [EmailService],
})
export class EmailModule {}
