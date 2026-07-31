import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import {
  isRateLimitDisabled,
  resolveTrustProxyHops,
} from "../rate-limit/rate-limit.constants";

export type HealthStatus = {
  status: "ok";
  timestamp: string;
  database: "ok";
};

export type ReadinessStatus = {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    database: {
      status: "ok" | "failed";
    };
    criticalEnvironment: {
      status: "ok" | "missing";
      missing: string[];
    };
    observability: {
      sentryConfigured: boolean;
      sentryReleaseConfigured: boolean;
    };
    // Controls that degrade silently rather than erroring when
    // misconfigured, so the only way to notice is to ask. A production
    // process refuses to boot without them (auth/security-config.ts); this
    // makes the same state observable in staging and after a config change.
    authHardening: {
      captchaEnabled: boolean;
      rateLimitEnabled: boolean;
      rateLimitCountersShared: boolean;
      trustProxyHops: number;
    };
  };
};

const CRITICAL_ENV_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthStatus> {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "ok",
    };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    const timestamp = new Date().toISOString();
    const databaseStatus = await this.checkDatabase();
    const missingCriticalEnvironment = CRITICAL_ENV_VARS.filter(
      (name) => !process.env[name]?.trim(),
    );
    const status =
      databaseStatus === "ok" && missingCriticalEnvironment.length === 0
        ? "ready"
        : "not_ready";

    return {
      status,
      timestamp,
      checks: {
        database: {
          status: databaseStatus,
        },
        criticalEnvironment: {
          status: missingCriticalEnvironment.length === 0 ? "ok" : "missing",
          missing: missingCriticalEnvironment,
        },
        observability: {
          sentryConfigured: Boolean(process.env.SENTRY_DSN?.trim()),
          sentryReleaseConfigured: Boolean(process.env.SENTRY_RELEASE?.trim()),
        },
        authHardening: {
          captchaEnabled: Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()),
          rateLimitEnabled: !isRateLimitDisabled(),
          rateLimitCountersShared: Boolean(process.env.REDIS_URL?.trim()),
          trustProxyHops: resolveTrustProxyHops(),
        },
      },
    };
  }

  private async checkDatabase(): Promise<"ok" | "failed"> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "failed";
    }
  }
}
