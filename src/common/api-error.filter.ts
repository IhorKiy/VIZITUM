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

type HttpExceptionPayload = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  fieldErrors?: unknown;
};

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId =
      request.requestId ?? request.header(REQUEST_ID_HEADER) ?? "unknown";

    const status = this.getStatus(exception);
    const body = this.toErrorResponse(exception, requestId);

    response.status(status).json(body);
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toErrorResponse(
    exception: unknown,
    requestId: string,
  ): ApiErrorResponse {
    if (!(exception instanceof HttpException)) {
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
