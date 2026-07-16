import { Module } from "@nestjs/common";

import { S3StorageClient } from "../storage/s3-storage.client";
import { StorageConfigService } from "../storage/storage.config";
import { TenancyController } from "./tenancy.controller";
import { TenancyService } from "./tenancy.service";

// S3StorageClient is provided directly (not via StorageModule) because
// StorageModule imports AuthModule, which imports TenancyModule — pulling the
// whole module in here would close a circular dependency. Both providers are
// stateless env-driven singletons, so a second instance is harmless.
@Module({
  controllers: [TenancyController],
  providers: [TenancyService, StorageConfigService, S3StorageClient],
  exports: [TenancyService],
})
export class TenancyModule {}
