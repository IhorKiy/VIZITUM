import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { RouteTemplatesController } from "./route-templates.controller";
import { RouteTemplatesService } from "./route-templates.service";
import { RoutesController } from "./routes.controller";
import { RoutesService } from "./routes.service";

@Module({
  imports: [AuthModule],
  controllers: [RoutesController, RouteTemplatesController],
  providers: [RoutesService, RouteTemplatesService],
  exports: [RoutesService, RouteTemplatesService],
})
export class RoutesModule {}
