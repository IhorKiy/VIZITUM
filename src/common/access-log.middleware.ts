import type { NextFunction, Request, Response } from "express";
import { performance } from "node:perf_hooks";

import { JsonLogger } from "./json-logger.service";
import { REQUEST_ID_HEADER } from "./request-id.middleware";

const logger = new JsonLogger();

export function applyAccessLog(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const startedAt = performance.now();

  response.on("finish", () => {
    logger.logHttp({
      requestId:
        request.requestId ?? request.header(REQUEST_ID_HEADER) ?? "unknown",
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode: response.statusCode,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      userAgent: request.header("user-agent"),
    });
  });

  next();
}
