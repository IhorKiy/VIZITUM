import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { applyAccessLog } from "./common/access-log.middleware";
import { ApiErrorFilter } from "./common/api-error.filter";
import { JsonLogger } from "./common/json-logger.service";
import { applyRequestId } from "./common/request-id.middleware";
import { applyCsrfProtection } from "./modules/auth/csrf";

async function bootstrap() {
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";

  app.use(applyRequestId);
  app.use(applyAccessLog);
  app.use(applyCsrfProtection);
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrorFilter());

  await app.listen(port, host);
}

void bootstrap();
