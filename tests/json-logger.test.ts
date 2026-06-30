import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JsonLogger } from "../src/common/json-logger.service";

describe("JSON logger", () => {
  it("writes structured application logs", () => {
    const lines = captureStdout(() => {
      const logger = new JsonLogger();

      logger.log({ message: "platform_ready", tenantId: "tenant-a" }, "App");
    });
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;

    assert.equal(entry.level, "log");
    assert.equal(entry.message, "platform_ready");
    assert.equal(entry.context, "App");
    assert.equal(entry.tenantId, "tenant-a");
    assert.equal(typeof entry.timestamp, "string");
  });

  it("writes structured HTTP access logs", () => {
    const lines = captureStdout(() => {
      const logger = new JsonLogger();

      logger.logHttp({
        requestId: "request-a",
        method: "GET",
        path: "/api/health",
        statusCode: 200,
        durationMs: 12.34,
      });
    });
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;

    assert.equal(entry.level, "log");
    assert.equal(entry.message, "http_request");
    assert.equal(entry.context, "HttpAccess");
    assert.equal(entry.requestId, "request-a");
    assert.equal(entry.path, "/api/health");
    assert.equal(entry.durationMs, 12.34);
  });
});

function captureStdout(action: () => void): string[] {
  const originalWrite = process.stdout.write;
  const lines: string[] = [];

  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk).trim());
    return true;
  }) as typeof process.stdout.write;

  try {
    action();
  } finally {
    process.stdout.write = originalWrite;
  }

  return lines;
}
