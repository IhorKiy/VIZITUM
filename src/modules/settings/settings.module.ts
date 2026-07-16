import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AdminSettingsController } from "./admin-settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
