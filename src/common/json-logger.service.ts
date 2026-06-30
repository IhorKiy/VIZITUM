import { Injectable, type LoggerService } from "@nestjs/common";

export type JsonLogLevel = "debug" | "error" | "log" | "verbose" | "warn";

export type JsonLogEntry = {
  timestamp: string;
  level: JsonLogLevel;
  message: string;
  context?: string;
  stack?: string;
  [key: string]: unknown;
};

@Injectable()
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) {
    this.write("log", message, context);
  }

  error(message: unknown, stack?: string, context?: string) {
    this.write("error", message, context, { stack });
  }

  warn(message: unknown, context?: string) {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string) {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string) {
    this.write("verbose", message, context);
  }

  logHttp(entry: {
    requestId: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    userAgent?: string;
  }) {
    this.write("log", "http_request", "HttpAccess", entry);
  }

  logError(entry: {
    requestId: string;
    method?: string;
    path?: string;
    statusCode?: number;
    errorName?: string;
    errorCode?: string;
    stack?: string;
  }) {
    this.write("error", "request_failed", "HttpError", entry);
  }

  logJob(entry: {
    jobId: string;
    jobType: string;
    status: string;
    tenantId?: string;
    visitId?: string;
    requestId?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) {
    const level = entry.status === "failed" ? "error" : "log";

    this.write(level, "ai_job_status", "AiJob", entry);
  }

  private write(
    level: JsonLogLevel,
    message: unknown,
    context?: string,
    fields: Record<string, unknown> = {},
  ) {
    const entry = normalizeLogEntry(level, message, context, fields);
    const output = `${JSON.stringify(entry)}\n`;

    if (level === "error") {
      process.stderr.write(output);
      return;
    }

    process.stdout.write(output);
  }
}

function normalizeLogEntry(
  level: JsonLogLevel,
  message: unknown,
  context: string | undefined,
  fields: Record<string, unknown>,
): JsonLogEntry {
  if (isLogObject(message)) {
    return {
      timestamp: new Date().toISOString(),
      level,
      message: normalizeMessage(message.message ?? "log"),
      ...(context ? { context } : {}),
      ...sanitizeFields(message),
      ...sanitizeFields(fields),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    level,
    message: normalizeMessage(message),
    ...(context ? { context } : {}),
    ...sanitizeFields(fields),
  };
}

function normalizeMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof Error) {
    return message.message;
  }

  return JSON.stringify(message);
}

function sanitizeFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== undefined && typeof value !== "function",
    ),
  );
}

function isLogObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
