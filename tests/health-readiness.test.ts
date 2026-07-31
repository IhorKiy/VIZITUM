import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HealthService } from "../src/modules/health/health.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";

describe("health readiness", () => {
  it("reports ready when database and critical env are available", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgresql://example",
        SESSION_SECRET: "secret",
        SENTRY_DSN: "https://public@sentry.example/42",
        SENTRY_RELEASE: "test-release",
      },
      async () => {
        const service = new HealthService(createPrismaStub("ok"));
        const readiness = await service.getReadiness();

        assert.equal(readiness.status, "ready");
        assert.equal(readiness.checks.database.status, "ok");
        assert.equal(readiness.checks.criticalEnvironment.status, "ok");
        assert.deepEqual(readiness.checks.criticalEnvironment.missing, []);
        assert.equal(readiness.checks.observability.sentryConfigured, true);
        assert.equal(
          readiness.checks.observability.sentryReleaseConfigured,
          true,
        );
      },
    );
  });

  it("reports missing critical environment without exposing values", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgresql://example",
        SESSION_SECRET: undefined,
        SENTRY_DSN: undefined,
        SENTRY_RELEASE: undefined,
      },
      async () => {
        const service = new HealthService(createPrismaStub("ok"));
        const readiness = await service.getReadiness();

        assert.equal(readiness.status, "not_ready");
        assert.equal(readiness.checks.criticalEnvironment.status, "missing");
        assert.deepEqual(readiness.checks.criticalEnvironment.missing, [
          "SESSION_SECRET",
        ]);
        assert.equal(readiness.checks.observability.sentryConfigured, false);
        assert.equal(
          readiness.checks.observability.sentryReleaseConfigured,
          false,
        );
      },
    );
  });

  it("reports database failures as not ready", async () => {
    await withEnv(
      {
        DATABASE_URL: "postgresql://example",
        SESSION_SECRET: "secret",
      },
      async () => {
        const service = new HealthService(createPrismaStub("failed"));
        const readiness = await service.getReadiness();

        assert.equal(readiness.status, "not_ready");
        assert.equal(readiness.checks.database.status, "failed");
      },
    );
  });
});

function createPrismaStub(status: "ok" | "failed"): PrismaService {
  return {
    $queryRaw: async () => {
      if (status === "failed") {
        throw new Error("database unavailable");
      }

      return [{ "?column?": 1 }];
    },
  } as unknown as PrismaService;
}

describe("readiness proxy diagnostic", () => {
  const OPERATOR_ENV = {
    DATABASE_URL: "postgresql://example",
    SESSION_SECRET: "s",
  };

  it("is withheld from an anonymous caller", async () => {
    await withEnv(OPERATOR_ENV, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness({
        clientAddress: "10.0.0.4",
        forwardedFor: "203.0.113.10, 10.0.0.4, 10.0.0.9",
      });

      // The state this diagnostic exists to catch — hops too low — is
      // exactly the state where the resolved address is a piece of internal
      // infrastructure. Handing that to anyone who curls a public endpoint
      // would be the leak, and the two numbers together also say precisely
      // how many entries to prepend to forge an address.
      assert.equal(readiness.checks.authHardening.proxyResolution, undefined);
      assert.ok(!JSON.stringify(readiness).includes("10.0.0.4"));
      assert.ok(!JSON.stringify(readiness).includes("10.0.0.9"));
    });
  });

  it("reports the resolved address and chain length to an operator", async () => {
    await withEnv(OPERATOR_ENV, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness({
        clientAddress: "203.0.113.10",
        forwardedFor: "203.0.113.10, 198.51.100.7",
        isOperator: true,
      });

      assert.deepEqual(readiness.checks.authHardening.proxyResolution, {
        clientAddress: "203.0.113.10",
        forwardedHopCount: 2,
      });
    });
  });

  it("refuses to echo a resolved value that is not an IP", async () => {
    await withEnv(OPERATOR_ENV, async () => {
      const service = new HealthService(createPrismaStub("ok"));

      // Not hypothetical: with a numeric `trust proxy` Express never parses
      // the forwarded entries, so request.ip is whatever text sat at that
      // position. tests/trust-proxy-resolution.test.ts proves it end to end.
      for (const hostile of [
        "<script>alert(1)</script>",
        "A".repeat(2000),
        "unknown",
      ]) {
        const readiness = await service.getReadiness({
          clientAddress: hostile,
          forwardedFor: `${hostile}, 198.51.100.7`,
          isOperator: true,
        });

        assert.equal(
          readiness.checks.authHardening.proxyResolution?.clientAddress,
          "invalid",
        );
      }
    });
  });

  it("distinguishes no request context from an unusable one", async () => {
    await withEnv(OPERATOR_ENV, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness({ isOperator: true });

      // "unknown" here means the caller supplied nothing — it must not
      // collide with a literal `X-Forwarded-For: unknown`, which the spec
      // allows and which reports as "invalid" above.
      assert.deepEqual(readiness.checks.authHardening.proxyResolution, {
        clientAddress: "unknown",
        forwardedHopCount: 0,
      });
    });
  });
});

async function withEnv(
  values: Record<string, string | undefined>,
  action: () => Promise<void>,
): Promise<void> {
  const originalValues = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    await action();
  } finally {
    for (const [name, value] of Object.entries(originalValues)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
