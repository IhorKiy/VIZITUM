import { Injectable } from "@nestjs/common";

import { JsonLogger } from "./json-logger.service";

export type SentryCaptureInput = {
  exception: unknown;
  requestId: string;
  method?: string;
  path?: string;
  statusCode?: number;
  errorCode?: string;
  module?: string;
  operation?: string;
};

type SentryConfig = {
  dsn: string;
  environment: string;
  release?: string;
  endpoint: string;
};

type SentryTransport = (input: {
  endpoint: string;
  body: string;
}) => Promise<void>;

@Injectable()
export class SentryService {
  private readonly logger = new JsonLogger();
  private readonly config = buildSentryConfig();

  constructor(private readonly transport: SentryTransport = sendEnvelope) {}

  isEnabled(): boolean {
    return Boolean(this.config);
  }

  async captureException(input: SentryCaptureInput): Promise<void> {
    if (!this.config) {
      return;
    }

    try {
      await this.transport({
        endpoint: this.config.endpoint,
        body: buildEnvelope(this.config, input),
      });
    } catch (error) {
      this.logger.warn(
        {
          message: "sentry_capture_failed",
          requestId: input.requestId,
          errorMessage:
            error instanceof Error ? error.message : "Sentry capture failed.",
        },
        "Sentry",
      );
    }
  }
}

function buildSentryConfig(): SentryConfig | null {
  const dsn = process.env.SENTRY_DSN?.trim();

  if (!dsn) {
    return null;
  }

  const parsedDsn = new URL(dsn);
  const pathParts = parsedDsn.pathname.split("/").filter(Boolean);
  const projectId = pathParts.at(-1);

  if (!projectId) {
    throw new Error("SENTRY_DSN must include a project id.");
  }

  const basePath = pathParts.slice(0, -1).join("/");
  const endpoint = `${parsedDsn.protocol}//${parsedDsn.host}${
    basePath ? `/${basePath}` : ""
  }/api/${projectId}/envelope/`;

  return {
    dsn,
    endpoint,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || "development",
    release: process.env.SENTRY_RELEASE?.trim() || undefined,
  };
}

function buildEnvelope(
  config: SentryConfig,
  input: SentryCaptureInput,
): string {
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const timestamp = new Date().toISOString();
  const exception =
    input.exception instanceof Error
      ? input.exception
      : new Error("Unknown exception");
  const event = {
    event_id: eventId,
    timestamp,
    platform: "node",
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    level: "error",
    message: exception.message,
    exception: {
      values: [
        {
          type: exception.constructor.name,
          value: exception.message,
          stacktrace: exception.stack
            ? { frames: parseStackFrames(exception.stack) }
            : undefined,
        },
      ],
    },
    tags: {
      requestId: input.requestId,
      method: input.method,
      statusCode: input.statusCode?.toString(),
      errorCode: input.errorCode,
      module: input.module,
      operation: input.operation,
    },
    request: {
      method: input.method,
      url: input.path,
    },
    contexts: {
      runtime: {
        name: "node",
        version: process.version,
      },
    },
  };

  return [
    JSON.stringify({ dsn: config.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

function parseStackFrames(stack: string): Array<Record<string, unknown>> {
  return stack
    .split("\n")
    .slice(1, 21)
    .map((line) => line.trim())
    .map((line) => ({ function: line }))
    .reverse();
}

async function sendEnvelope(input: {
  endpoint: string;
  body: string;
}): Promise<void> {
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
    },
    body: input.body,
  });

  if (!response.ok) {
    throw new Error(
      `Sentry responded with ${response.status} ${response.statusText}.`,
    );
  }
}
