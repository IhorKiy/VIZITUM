import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

export function applyRequestId(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const incomingRequestId = request.header(REQUEST_ID_HEADER);
  const requestId = incomingRequestId?.trim() || randomUUID();

  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction) {
    applyRequestId(request, response, next);
  }
}
