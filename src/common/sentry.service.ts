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

// V8 stack lines come as "at fn (file:line:col)" or "at file:line:col";
// Sentry wants structured frames ordered oldest-first.
const FRAME_WITH_FUNCTION = /^at (.+?) \((.+):(\d+):(\d+)\)$/;
const FRAME_WITHOUT_FUNCTION = /^at (.+):(\d+):(\d+)$/;

function parseStackFrames(stack: string): Array<Record<string, unknown>> {
  return stack
    .split("\n")
    .slice(1, 21)
    .map((line) => line.trim())
    .map((line) => parseStackFrame(line))
    .reverse();
}

function parseStackFrame(line: string): Record<string, unknown> {
  const withFunction = FRAME_WITH_FUNCTION.exec(line);

  if (withFunction) {
    return {
      function: withFunction[1],
      filename: withFunction[2],
      lineno: Number(withFunction[3]),
      colno: Number(withFunction[4]),
    };
  }

  const withoutFunction = FRAME_WITHOUT_FUNCTION.exec(line);

  if (withoutFunction) {
    return {
      function: "<anonymous>",
      filename: withoutFunction[1],
      lineno: Number(withoutFunction[2]),
      colno: Number(withoutFunction[3]),
    };
  }

  return { function: line };
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
