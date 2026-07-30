// Lightweight Sentry reporter for the web app, mirroring the SDK-free
// envelope approach of src/common/sentry.service.ts on the backend. The
// two workspaces intentionally do not share code, so this copy stays
// self-contained. Every path is fail-safe: a missing DSN or unreachable
// endpoint must never affect user-facing behavior.

export type SentryWebConfig = {
  dsn: string;
  environment: string;
  release?: string;
  endpoint: string;
};

export type ErrorReportInput = {
  exception: unknown;
  // How the error was caught: "onerror", "onunhandledrejection",
  // "global-error", "server-request".
  mechanism: string;
  platform: "javascript" | "node";
  tags?: Record<string, string | undefined>;
  request?: { method?: string; url?: string };
};

export type ErrorReportTransport = (input: {
  endpoint: string;
  body: string;
}) => Promise<void>;

export function resolveSentryWebConfig(env: {
  dsn?: string;
  environment?: string;
  release?: string;
}): SentryWebConfig | null {
  const dsn = env.dsn?.trim();

  if (!dsn) {
    return null;
  }

  let parsedDsn: URL;

  try {
    parsedDsn = new URL(dsn);
  } catch {
    return null;
  }

  const pathParts = parsedDsn.pathname.split("/").filter(Boolean);
  const projectId = pathParts.at(-1);

  if (!projectId) {
    return null;
  }

  const basePath = pathParts.slice(0, -1).join("/");
  const endpoint = `${parsedDsn.protocol}//${parsedDsn.host}${
    basePath ? `/${basePath}` : ""
  }/api/${projectId}/envelope/`;

  return {
    dsn,
    endpoint,
    environment: env.environment?.trim() || "development",
    release: env.release?.trim() || undefined,
  };
}

export function buildErrorEnvelope(
  config: SentryWebConfig,
  input: ErrorReportInput,
  eventId: string,
  timestamp: string,
): string {
  const exception = toError(input.exception);
  const tags = Object.fromEntries(
    Object.entries({ mechanism: input.mechanism, ...input.tags }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const event = {
    event_id: eventId,
    timestamp,
    platform: input.platform,
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
    tags,
    ...(input.request ? { request: input.request } : {}),
  };

  return [
    JSON.stringify({ dsn: config.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

// Dedupe/cap so an error loop (e.g. a render error firing every frame)
// cannot flood Sentry from one pageload.
export function createErrorReporter(options: {
  config: SentryWebConfig | null;
  transport: ErrorReportTransport;
  maxEvents?: number;
}): { report: (input: ErrorReportInput) => Promise<void> } {
  const seen = new Set<string>();
  const maxEvents = options.maxEvents ?? 10;
  let sentCount = 0;

  return {
    async report(input: ErrorReportInput): Promise<void> {
      if (!options.config || sentCount >= maxEvents) {
        return;
      }

      const key = dedupeKey(input.exception);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      sentCount += 1;

      try {
        await options.transport({
          endpoint: options.config.endpoint,
          body: buildErrorEnvelope(
            options.config,
            input,
            randomEventId(),
            new Date().toISOString(),
          ),
        });
      } catch {
        // Never surface reporting failures to the app.
      }
    },
  };
}

export function dedupeKey(exception: unknown): string {
  const error = toError(exception);
  const firstStackLine =
    error.stack?.split("\n").slice(1, 2).join("").trim() ?? "";

  return `${error.constructor.name}:${error.message}:${firstStackLine}`;
}

function toError(exception: unknown): Error {
  if (exception instanceof Error) {
    return exception;
  }

  return new Error(
    typeof exception === "string" ? exception : "Unknown exception",
  );
}

// Handles V8 ("at fn (file:line:col)", "at file:line:col") and
// Firefox/Safari ("fn@file:line:col") frame shapes; Sentry expects
// oldest-first ordering.
const V8_FRAME_WITH_FUNCTION = /^at (.+?) \((.+):(\d+):(\d+)\)$/;
const V8_FRAME_WITHOUT_FUNCTION = /^at (.+):(\d+):(\d+)$/;
const GECKO_FRAME = /^(.*)@(.+):(\d+):(\d+)$/;

export function parseStackFrames(
  stack: string,
): Array<Record<string, unknown>> {
  return stack
    .split("\n")
    .filter((line, index) => index > 0 || !line.startsWith("Error"))
    .slice(0, 20)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseStackFrame(line))
    .reverse();
}

function parseStackFrame(line: string): Record<string, unknown> {
  const v8WithFunction = V8_FRAME_WITH_FUNCTION.exec(line);

  if (v8WithFunction) {
    return {
      function: v8WithFunction[1],
      filename: v8WithFunction[2],
      lineno: Number(v8WithFunction[3]),
      colno: Number(v8WithFunction[4]),
    };
  }

  const v8WithoutFunction = V8_FRAME_WITHOUT_FUNCTION.exec(line);

  if (v8WithoutFunction) {
    return {
      function: "<anonymous>",
      filename: v8WithoutFunction[1],
      lineno: Number(v8WithoutFunction[2]),
      colno: Number(v8WithoutFunction[3]),
    };
  }

  const gecko = GECKO_FRAME.exec(line);

  if (gecko) {
    return {
      function: gecko[1] || "<anonymous>",
      filename: gecko[2],
      lineno: Number(gecko[3]),
      colno: Number(gecko[4]),
    };
  }

  return { function: line };
}

function randomEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

async function sendEnvelope(input: {
  endpoint: string;
  body: string;
}): Promise<void> {
  await fetch(input.endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope" },
    body: input.body,
    keepalive: true,
  });
}

// NEXT_PUBLIC_* references must stay literal so Next inlines them into
// the browser bundle; the same vars serve the Next server runtime.
let defaultReporter: ReturnType<typeof createErrorReporter> | null = null;

export function reportError(input: ErrorReportInput): Promise<void> {
  if (!defaultReporter) {
    defaultReporter = createErrorReporter({
      config: resolveSentryWebConfig({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
      }),
      transport: sendEnvelope,
    });
  }

  return defaultReporter.report(input);
}
