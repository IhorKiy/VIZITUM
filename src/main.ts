import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { applyRequestId } from "./common/request-id.middleware";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 4000);

  app.use(applyRequestId);
  app.setGlobalPrefix("api");

  await app.listen(port, "127.0.0.1");
}

void bootstrap();
