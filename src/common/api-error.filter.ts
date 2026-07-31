import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { REQUEST_ID_HEADER } from "./request-id.middleware";
import type { ApiErrorResponse, ApiFieldErrors } from "./api-error.types";
import { JsonLogger } from "./json-logger.service";
import { SentryService } from "./sentry.service";

type HttpExceptionPayload = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  fieldErrors?: unknown;
};

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new JsonLogger();
  private readonly sentry = new SentryService();

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId =
      request.requestId ?? request.header(REQUEST_ID_HEADER) ?? "unknown";

    const status = this.getStatus(exception);
    const body = this.toErrorResponse(exception, requestId);

    this.logger.logError({
      requestId,
      method: request.method,
      path: request.originalUrl || request.url,
      statusCode: status,
      errorName:
        exception instanceof Error ? exception.constructor.name : undefined,
      errorCode: body.code,
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    if (status >= 500) {
      void this.sentry.captureException({
        exception,
        requestId,
        method: request.method,
        path: request.originalUrl || request.url,
        statusCode: status,
        errorCode: body.code,
        module: "api",
        operation: "request",
      });
    }

    response.status(status).json(body);
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return readHttpErrorStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toErrorResponse(
    exception: unknown,
    requestId: string,
  ): ApiErrorResponse {
    if (!(exception instanceof HttpException)) {
      const httpErrorStatus = readHttpErrorStatus(exception);

      if (httpErrorStatus) {
        return {
          code: HttpStatus[httpErrorStatus] ?? "HTTP_ERROR",
          message:
            httpErrorStatus === Number(HttpStatus.PAYLOAD_TOO_LARGE)
              ? "Request body is too large."
              : "Request could not be processed.",
          requestId,
        };
      }

      return {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error.",
        requestId,
      };
    }

    const payload = this.normalizePayload(exception.getResponse());
    const status = exception.getStatus();

    return {
      code: this.resolveCode(payload, status),
      message: this.resolveMessage(payload, exception),
      ...(payload.details !== undefined ? { details: payload.details } : {}),
      ...(isFieldErrors(payload.fieldErrors)
        ? { fieldErrors: payload.fieldErrors }
        : {}),
      requestId,
    };
  }

  private normalizePayload(response: string | object): HttpExceptionPayload {
    if (typeof response === "string") {
      return { message: response };
    }

    return response;
  }

  private resolveCode(payload: HttpExceptionPayload, status: number): string {
    if (typeof payload.code === "string" && payload.code.trim()) {
      return payload.code;
    }

    if (status === 400 && payload.fieldErrors) {
      return "VALIDATION_FAILED";
    }

    return HttpStatus[status] ?? "HTTP_ERROR";
  }

  private resolveMessage(
    payload: HttpExceptionPayload,
    exception: HttpException,
  ): string {
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }

    if (Array.isArray(payload.message)) {
      return "Validation failed.";
    }

    return exception.message || "Request failed.";
  }
}

/**
 * Status carried by an `http-errors` object rather than a Nest exception.
 *
 * body-parser throws these — a request over the explicit JSON body limit
 * arrives as a PayloadTooLargeError with `status: 413`, not as an
 * HttpException. Without this it fell through to 500, which both misreports
 * an ordinary client mistake as a server fault and sends every oversized
 * request to Sentry.
 *
 * Only 4xx is honoured. A 5xx from a library is a server fault and should
 * keep the generic 500 treatment, Sentry capture included.
 */
function readHttpErrorStatus(exception: unknown): number | null {
  if (!exception || typeof exception !== "object") {
    return null;
  }

  const candidate = (exception as { status?: unknown; statusCode?: unknown })
    .status;
  const fallback = (exception as { statusCode?: unknown }).statusCode;
  const status = typeof candidate === "number" ? candidate : fallback;

  if (typeof status !== "number" || status < 400 || status >= 500) {
    return null;
  }

  return status;
}

function isFieldErrors(value: unknown): value is ApiFieldErrors {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (messages) =>
      Array.isArray(messages) &&
      messages.every((message) => typeof message === "string"),
  );
}
