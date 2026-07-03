import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AdminSettingsController } from "./admin-settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
