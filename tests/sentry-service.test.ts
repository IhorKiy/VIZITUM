import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SentryService } from "../src/common/sentry.service";

describe("Sentry service", () => {
  it("stays disabled when SENTRY_DSN is not configured", async () => {
    const originalDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    let sent = false;
    const service = new SentryService(async () => {
      sent = true;
    });

    await service.captureException({
      exception: new Error("boom"),
      requestId: "request-a",
    });

    assert.equal(service.isEnabled(), false);
    assert.equal(sent, false);
    restoreEnv("SENTRY_DSN", originalDsn);
  });

  it("builds a scrubbed Sentry envelope when configured", async () => {
    const originalDsn = process.env.SENTRY_DSN;
    const originalEnvironment = process.env.SENTRY_ENVIRONMENT;
    process.env.SENTRY_DSN = "https://public@sentry.example/42";
    process.env.SENTRY_ENVIRONMENT = "test";
    let endpoint = "";
    let body = "";
    const service = new SentryService(async (input) => {
      endpoint = input.endpoint;
      body = input.body;
    });

    await service.captureException({
      exception: new Error("Database unavailable"),
      requestId: "request-a",
      method: "GET",
      path: "/api/health",
      statusCode: 500,
      errorCode: "INTERNAL_SERVER_ERROR",
      module: "health",
      operation: "readiness",
    });

    const [, , eventLine] = body.split("\n");
    const event = JSON.parse(eventLine) as {
      environment: string;
      message: string;
      request: { method: string; url: string };
      tags: Record<string, string>;
    };

    assert.equal(service.isEnabled(), true);
    assert.equal(endpoint, "https://sentry.example/api/42/envelope/");
    assert.equal(event.environment, "test");
    assert.equal(event.message, "Database unavailable");
    assert.deepEqual(event.request, {
      method: "GET",
      url: "/api/health",
    });
    assert.equal(event.tags.requestId, "request-a");
    assert.equal(event.tags.errorCode, "INTERNAL_SERVER_ERROR");

    restoreEnv("SENTRY_DSN", originalDsn);
    restoreEnv("SENTRY_ENVIRONMENT", originalEnvironment);
  });

  it("parses V8 stack lines into structured frames, oldest first", async () => {
    const originalDsn = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "https://public@sentry.example/42";
    let body = "";
    const service = new SentryService(async (input) => {
      body = input.body;
    });

    const exception = new Error("boom");
    exception.stack = [
      "Error: boom",
      "    at VisitsService.completeVisit (/app/src/modules/visits/visits.service.ts:120:15)",
      "    at /app/node_modules/@nestjs/core/router/router-proxy.js:9:17",
      "    at some opaque native frame",
    ].join("\n");

    await service.captureException({
      exception,
      requestId: "request-a",
    });

    const [, , eventLine] = body.split("\n");
    const event = JSON.parse(eventLine) as {
      exception: {
        values: Array<{
          stacktrace: { frames: Array<Record<string, unknown>> };
        }>;
      };
    };

    assert.deepEqual(event.exception.values[0].stacktrace.frames, [
      { function: "at some opaque native frame" },
      {
        function: "<anonymous>",
        filename: "/app/node_modules/@nestjs/core/router/router-proxy.js",
        lineno: 9,
        colno: 17,
      },
      {
        function: "VisitsService.completeVisit",
        filename: "/app/src/modules/visits/visits.service.ts",
        lineno: 120,
        colno: 15,
      },
    ]);

    restoreEnv("SENTRY_DSN", originalDsn);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
