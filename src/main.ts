import "reflect-metadata";
import "dotenv/config";
import "./types/express";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { applyAccessLog } from "./common/access-log.middleware";
import { ApiErrorFilter } from "./common/api-error.filter";
import { JsonLogger } from "./common/json-logger.service";
import { applyRequestId } from "./common/request-id.middleware";
import { applyCsrfProtection } from "./modules/auth/csrf";

// Field visit-report voice capture posts the recorded audio as base64 inside
// the JSON body of a single synchronous request (see
// visits/:visitId/ai/field-report-transcriptions) instead of going through
// the presigned-upload flow used for persisted voice notes, so it needs a
// much higher limit than Nest's default ~100kb body parser.
const JSON_BODY_SIZE_LIMIT = "20mb";

async function bootstrap() {
  const logger = new JsonLogger();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bodyParser: false,
  });
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";

  app.useBodyParser("json", { limit: JSON_BODY_SIZE_LIMIT });
  app.useBodyParser("urlencoded", {
    extended: true,
    limit: JSON_BODY_SIZE_LIMIT,
  });
  app.use(applyRequestId);
  app.use(applyAccessLog);
  app.use(applyCsrfProtection);
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrorFilter());

  await app.listen(port, host);
}

void bootstrap();
