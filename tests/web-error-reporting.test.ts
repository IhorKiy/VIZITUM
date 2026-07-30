import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildErrorEnvelope,
  createErrorReporter,
  dedupeKey,
  parseStackFrames,
  resolveSentryWebConfig,
} from "../apps/web/lib/error-reporting";

const CONFIG = resolveSentryWebConfig({
  dsn: "https://public@sentry.example/7",
  environment: "test",
  release: "web@1.0.0",
});

describe("Web error reporting config", () => {
  it("derives the envelope endpoint from the DSN", () => {
    assert.ok(CONFIG);
    assert.equal(CONFIG.endpoint, "https://sentry.example/api/7/envelope/");
    assert.equal(CONFIG.environment, "test");
    assert.equal(CONFIG.release, "web@1.0.0");
  });

  it("returns null without a DSN or with an invalid one", () => {
    assert.equal(resolveSentryWebConfig({}), null);
    assert.equal(resolveSentryWebConfig({ dsn: "   " }), null);
    assert.equal(resolveSentryWebConfig({ dsn: "not-a-url" }), null);
    assert.equal(resolveSentryWebConfig({ dsn: "https://sentry.example" }), null);
  });
});

describe("Web error envelope", () => {
  it("builds an event with mechanism tag, request and stack frames", () => {
    assert.ok(CONFIG);
    const exception = new Error("render exploded");
    exception.stack = [
      "Error: render exploded",
      "    at Page (webpack://app/page.tsx:10:5)",
    ].join("\n");

    const body = buildErrorEnvelope(
      CONFIG,
      {
        exception,
        mechanism: "global-error",
        platform: "javascript",
        tags: { digest: "abc123", missing: undefined },
        request: { method: "GET", url: "/demo-team/field" },
      },
      "0".repeat(32),
      "2026-01-01T00:00:00.000Z",
    );

    const [header, itemHeader, eventLine] = body.split("\n");
    assert.equal(
      JSON.parse(header).dsn,
      "https://public@sentry.example/7",
    );
    assert.equal(JSON.parse(itemHeader).type, "event");

    const event = JSON.parse(eventLine) as {
      platform: string;
      environment: string;
      release: string;
      message: string;
      tags: Record<string, string>;
      request: { method: string; url: string };
      exception: {
        values: Array<{
          stacktrace: { frames: Array<Record<string, unknown>> };
        }>;
      };
    };

    assert.equal(event.platform, "javascript");
    assert.equal(event.environment, "test");
    assert.equal(event.release, "web@1.0.0");
    assert.equal(event.message, "render exploded");
    assert.equal(event.tags.mechanism, "global-error");
    assert.equal(event.tags.digest, "abc123");
    assert.ok(!("missing" in event.tags));
    assert.deepEqual(event.request, {
      method: "GET",
      url: "/demo-team/field",
    });
    assert.deepEqual(event.exception.values[0].stacktrace.frames, [
      {
        function: "Page",
        filename: "webpack://app/page.tsx",
        lineno: 10,
        colno: 5,
      },
    ]);
  });

  it("wraps non-Error exceptions", () => {
    assert.ok(CONFIG);
    const body = buildErrorEnvelope(
      CONFIG,
      { exception: "plain string", mechanism: "onerror", platform: "javascript" },
      "0".repeat(32),
      "2026-01-01T00:00:00.000Z",
    );
    const event = JSON.parse(body.split("\n")[2]) as { message: string };

    assert.equal(event.message, "plain string");
  });
});

describe("Web stack frame parsing", () => {
  it("parses V8 and Gecko frame shapes, oldest first", () => {
    const frames = parseStackFrames(
      [
        "Error: boom",
        "    at handleClick (https://app.example/js/main.js:100:20)",
        "    at https://app.example/js/main.js:200:1",
        "submitForm@https://app.example/js/form.js:5:9",
        "@https://app.example/js/anon.js:1:1",
        "opaque native line",
      ].join("\n"),
    );

    assert.deepEqual(frames, [
      { function: "opaque native line" },
      {
        function: "<anonymous>",
        filename: "https://app.example/js/anon.js",
        lineno: 1,
        colno: 1,
      },
      {
        function: "submitForm",
        filename: "https://app.example/js/form.js",
        lineno: 5,
        colno: 9,
      },
      {
        function: "<anonymous>",
        filename: "https://app.example/js/main.js",
        lineno: 200,
        colno: 1,
      },
      {
        function: "handleClick",
        filename: "https://app.example/js/main.js",
        lineno: 100,
        colno: 20,
      },
    ]);
  });
});

describe("Web error reporter", () => {
  it("dedupes identical errors and caps events per pageload", async () => {
    const sent: string[] = [];
    const reporter = createErrorReporter({
      config: CONFIG,
      transport: async (input) => {
        sent.push(input.body);
      },
      maxEvents: 2,
    });

    const repeated = new Error("same error");
    await reporter.report({
      exception: repeated,
      mechanism: "onerror",
      platform: "javascript",
    });
    await reporter.report({
      exception: repeated,
      mechanism: "onerror",
      platform: "javascript",
    });
    assert.equal(sent.length, 1);

    await reporter.report({
      exception: new Error("second error"),
      mechanism: "onerror",
      platform: "javascript",
    });
    assert.equal(sent.length, 2);

    await reporter.report({
      exception: new Error("third error beyond cap"),
      mechanism: "onerror",
      platform: "javascript",
    });
    assert.equal(sent.length, 2);
  });

  it("is a no-op without config and swallows transport failures", async () => {
    const disabled = createErrorReporter({
      config: null,
      transport: async () => {
        throw new Error("must not be called");
      },
    });

    await disabled.report({
      exception: new Error("boom"),
      mechanism: "onerror",
      platform: "javascript",
    });

    const failing = createErrorReporter({
      config: CONFIG,
      transport: async () => {
        throw new Error("network down");
      },
    });

    await failing.report({
      exception: new Error("boom"),
      mechanism: "onerror",
      platform: "javascript",
    });
  });

  it("keys dedupe on type, message and top stack frame", () => {
    const a = new Error("boom");
    a.stack = "Error: boom\n    at a (file.js:1:1)";
    const b = new Error("boom");
    b.stack = "Error: boom\n    at b (file.js:2:2)";

    assert.notEqual(dedupeKey(a), dedupeKey(b));
    assert.equal(dedupeKey(a), dedupeKey(a));
  });
});
