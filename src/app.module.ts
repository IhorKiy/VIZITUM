import { Module } from "@nestjs/common";

import { HealthModule } from "./modules/health/health.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";

@Module({
  imports: [PrismaModule, HealthModule, TenancyModule],
})
export class AppModule {}
