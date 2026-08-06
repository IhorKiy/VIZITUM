import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { LocationCategoriesController } from "./location-categories.controller";
import { LocationCategoriesService } from "./location-categories.service";
import { LocationsController } from "./locations.controller";
import { LocationsService } from "./locations.service";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [LocationsController, LocationCategoriesController],
  providers: [LocationsService, LocationCategoriesService],
  exports: [LocationsService, LocationCategoriesService],
})
export class LocationsModule {}
