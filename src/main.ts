import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { ApiErrorFilter } from "./common/api-error.filter";
import { applyCsrfProtection } from "./modules/auth/csrf";
import { applyRequestId } from "./common/request-id.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4000);

  app.use(applyRequestId);
  app.use(applyCsrfProtection);
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrorFilter());

  await app.listen(port, "127.0.0.1");
}

void bootstrap();
