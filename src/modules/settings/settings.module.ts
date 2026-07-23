import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { StorageModule } from "../storage/storage.module";
import { AdminSettingsController } from "./admin-settings.controller";
import { FieldSettingsController } from "./field-settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [AdminSettingsController, FieldSettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
