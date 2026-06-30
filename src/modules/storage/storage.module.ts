import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { S3StorageClient } from "./s3-storage.client";
import { StorageConfigService } from "./storage.config";
import { StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";

@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [StorageService, StorageConfigService, S3StorageClient],
  exports: [StorageService, StorageConfigService, S3StorageClient],
})
export class StorageModule {}
