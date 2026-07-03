import { Module } from "@nestjs/common";

import { AiModule } from "./modules/ai/ai.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { LocationsModule } from "./modules/locations/locations.module";
import { OperationsModule } from "./modules/operations/operations.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { ProductsModule } from "./modules/products/products.module";
import { RolesModule } from "./modules/roles/roles.module";
import { RoutesModule } from "./modules/routes/routes.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { StorageModule } from "./modules/storage/storage.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";
import { UsersModule } from "./modules/users/users.module";
import { VisitsModule } from "./modules/visits/visits.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    PlatformModule,
    AuthModule,
    TenancyModule,
    UsersModule,
    RolesModule,
    LocationsModule,
    ProductsModule,
    RoutesModule,
    SettingsModule,
    VisitsModule,
    TasksModule,
    ImportsModule,
    AiModule,
    StorageModule,
    AuditModule,
    OperationsModule,
  ],
})
export class AppModule {}
