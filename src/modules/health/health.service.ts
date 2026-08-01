import { Injectable } from "@nestjs/common";
import { isIP } from "node:net";

import { PrismaService } from "../prisma/prisma.service";
import { resolveTrustProxyHops } from "../../common/trust-proxy";
import { isRateLimitDisabled } from "../rate-limit/rate-limit.constants";

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
      // What `trustProxyHops` actually produced for *this* request, so the
      // setting can be checked instead of reasoned about. Present only for a
      // caller holding the platform operations token — see
      // describeProxyResolution for why it is not anonymous.
      proxyResolution?: {
        clientAddress: string;
        forwardedHopCount: number;
      };
    };
  };
};

/** What the request looked like to Express, for the proxy diagnostic below. */
export type ReadinessRequestContext = {
  /** `request.ip` — the address Express resolved after applying `trust proxy`. */
  clientAddress?: string;
  /** Raw `X-Forwarded-For`, used only to count entries. */
  forwardedFor?: string;
  /**
   * Whether the caller proved it is an operator. The diagnostic is withheld
   * from everyone else; readiness itself stays anonymous so uptime monitors
   * keep working.
   */
  isOperator?: boolean;
};

/**
 * Turns the configured hop count into something checkable.
 *
 * `trustProxyHops` on its own only says what was configured, and both ways of
 * getting it wrong are silent: too low and every caller resolves to an
 * infrastructure address, so the whole world shares one rate-limit bucket and
 * the `ipHash` on every session is identical; too high and the value is
 * client-controlled. Neither shows up as an error anywhere.
 *
 * So this reports the resolved address as well. Curl the endpoint from a
 * machine whose public address you know: if `clientAddress` is that address,
 * the setting is right. If it is not, `forwardedHopCount` is the answer —
 * Express counts hops inward from the socket and each `X-Forwarded-For` entry
 * is one hop, so the correct `TRUST_PROXY_HOPS` is the number of entries.
 *
 * **Operator-only, and that is the whole reason for the gate.** In the exact
 * state this is meant to diagnose — hops set too low — the resolved address
 * is an intermediate entry, i.e. a piece of internal infrastructure, so an
 * anonymous caller would be handed it. Worse, the two numbers together are a
 * forgery recipe: they say precisely how many entries to prepend to make a
 * chosen address authoritative on a directly reachable API. Both stop being
 * a concern once the reader already holds the operations token.
 *
 * The address is validated as an IP before it is echoed. With a numeric
 * `trust proxy` Express compiles `(addr, i) => i < n` and never parses the
 * entries, so `request.ip` is whatever text sat at that position in the
 * header — `<script>alert(1)</script>` reaches this function intact. Anything
 * that is not an IP is reported as `invalid`, which also keeps a literal
 * `X-Forwarded-For: unknown` (a real placeholder the spec allows) from being
 * mistaken for "no request context".
 */
function describeProxyResolution(context: ReadinessRequestContext): {
  clientAddress: string;
  forwardedHopCount: number;
} {
  const forwardedEntries = (context.forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const resolved = context.clientAddress?.trim() ?? "";

  return {
    clientAddress: resolved
      ? isIP(resolved)
        ? resolved
        : "invalid"
      : "unknown",
    forwardedHopCount: forwardedEntries.length,
  };
}

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

  // The request context is optional so the readiness checks stay callable
  // without constructing one; absent, the proxy diagnostic just reports
  // "unknown" and no hops.
  async getReadiness(
    requestContext: ReadinessRequestContext = {},
  ): Promise<ReadinessStatus> {
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
          ...(requestContext.isOperator
            ? { proxyResolution: describeProxyResolution(requestContext) }
            : {}),
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
