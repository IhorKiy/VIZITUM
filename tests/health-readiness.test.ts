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
