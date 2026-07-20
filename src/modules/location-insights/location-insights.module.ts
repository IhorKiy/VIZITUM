import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { LocationAssortmentController } from "./location-assortment.controller";
import { LocationAssortmentService } from "./location-assortment.service";
import { LocationInsightsSummaryController } from "./location-insights-summary.controller";
import { LocationInsightsSummaryService } from "./location-insights-summary.service";
import { LocationPotentialController } from "./location-potential.controller";
import { LocationPotentialService } from "./location-potential.service";

@Module({
  imports: [AuthModule],
  controllers: [
    LocationPotentialController,
    LocationAssortmentController,
    LocationInsightsSummaryController,
  ],
  providers: [
    LocationPotentialService,
    LocationAssortmentService,
    LocationInsightsSummaryService,
  ],
  exports: [
    LocationPotentialService,
    LocationAssortmentService,
    LocationInsightsSummaryService,
  ],
})
export class LocationInsightsModule {}
