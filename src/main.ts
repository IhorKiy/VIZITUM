import "reflect-metadata";
import "dotenv/config";
import "./types/express";

import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { applyAccessLog } from "./common/access-log.middleware";
import { ApiErrorFilter } from "./common/api-error.filter";
import { JSON_BODY_LIMIT } from "./common/input-limits";
import { JsonLogger } from "./common/json-logger.service";
import { applyRequestId } from "./common/request-id.middleware";
import { resolveTrustProxyHops } from "./common/trust-proxy";
import { applyCsrfProtection } from "./modules/auth/csrf";
import { assertSecurityConfiguration } from "./modules/auth/security-config";

async function bootstrap() {
  const logger = new JsonLogger();

  // Before Nest builds anything: a production process missing a security
  // credential should refuse to start rather than come up quietly degraded.
  assertSecurityConfiguration(logger);

  // Routing flags are read once, when Express lazily builds its router on the
  // first `use`/route registration — and NestFactory.create already does one.
  // Set on the app Nest returns they are silently ignored, so the instance is
  // created here and configured before Nest is given it.
  //
  // Case-sensitive and strict routing mean `/api/Platform/...` and
  // `/api/auth/login/` stop reaching handlers registered under their
  // canonical spelling. Defence in depth only: csrf.ts normalizes the path
  // itself rather than relying on these (see the mixed-case bypass it fixes).
  const server = express();
  server.set("case sensitive routing", true);
  server.set("strict routing", true);
  // Exact hop count, never `true`: one hop too many and a client can forge
  // its own address via X-Forwarded-For, defeating every per-IP rate limit.
  server.set("trust proxy", resolveTrustProxyHops());
  server.set("x-powered-by", false);

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { logger },
  );
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? "0.0.0.0";

  // Explicit, rather than inheriting body-parser's undocumented 100 kB
  // default. Same size, but now a deliberate choice with a named constant.
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { limit: JSON_BODY_LIMIT, extended: true });

  // The API serves JSON to the Next layer, never HTML to a browser, so the
  // defaults that matter here are nosniff, no-referrer and HSTS. CSP is off:
  // it governs document loading and there are no documents; the web app sets
  // its own in next.config.ts.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(applyRequestId);
  app.use(applyAccessLog);
  app.use(applyCsrfProtection);
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();

  await app.listen(port, host);
}

void bootstrap();
