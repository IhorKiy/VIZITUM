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
  // `trustProxyHops` alone only says what was configured, and both ways of
  // getting it wrong are silent: too low and every caller resolves to an
  // infrastructure address (one shared rate-limit bucket, identical session
  // ipHash), too high and the value is client-controlled. These fields are
  // what make the setting checkable from outside — see describeProxyResolution.
  it("echoes the address Express resolved for this caller", async () => {
    await withEnv({ DATABASE_URL: "postgresql://example", SESSION_SECRET: "s" }, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness({
        clientAddress: "203.0.113.10",
        forwardedFor: "203.0.113.10, 198.51.100.7",
      });

      assert.equal(
        readiness.checks.authHardening.clientAddress,
        "203.0.113.10",
      );
    });
  });

  it("counts the forwarded chain, which is the hop count to configure", async () => {
    await withEnv({ DATABASE_URL: "postgresql://example", SESSION_SECRET: "s" }, async () => {
      const service = new HealthService(createPrismaStub("ok"));

      // Express counts hops inward from the socket and each X-Forwarded-For
      // entry is one hop, so the right TRUST_PROXY_HOPS is exactly this count.
      // For the deployed shape — client, then the Next server — that is 2.
      const twoHops = await service.getReadiness({
        clientAddress: "203.0.113.10",
        forwardedFor: "203.0.113.10, 198.51.100.7",
      });
      assert.equal(twoHops.checks.authHardening.forwardedHopCount, 2);

      const noProxy = await service.getReadiness({
        clientAddress: "203.0.113.10",
      });
      assert.equal(noProxy.checks.authHardening.forwardedHopCount, 0);
    });
  });

  it("never echoes the rest of the chain, only the caller's own address", async () => {
    await withEnv({ DATABASE_URL: "postgresql://example", SESSION_SECRET: "s" }, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness({
        clientAddress: "203.0.113.10",
        forwardedFor: "203.0.113.10, 10.0.0.4, 10.0.0.9",
      });

      // The intermediate entries are internal infrastructure and this
      // endpoint is public, so only a count of them leaves the process.
      const serialized = JSON.stringify(readiness);
      assert.ok(!serialized.includes("10.0.0.4"));
      assert.ok(!serialized.includes("10.0.0.9"));
      assert.equal(readiness.checks.authHardening.forwardedHopCount, 3);
    });
  });

  it("stays answerable when there is no request context at all", async () => {
    await withEnv({ DATABASE_URL: "postgresql://example", SESSION_SECRET: "s" }, async () => {
      const service = new HealthService(createPrismaStub("ok"));
      const readiness = await service.getReadiness();

      assert.equal(readiness.checks.authHardening.clientAddress, "unknown");
      assert.equal(readiness.checks.authHardening.forwardedHopCount, 0);
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
