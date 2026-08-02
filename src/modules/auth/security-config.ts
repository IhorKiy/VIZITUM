import type { LoggerService } from "@nestjs/common";

import { isSecretKeyValid } from "../../common/secret-box";

// Security controls that are optional everywhere else and mandatory in
// production. Each one degrades *silently* when its variable is missing —
// captcha becomes a no-op, rate-limit counters become per-process — which is
// the failure mode worth refusing to boot on: the app looks healthy and the
// control simply isn't there.
//
// Checked at bootstrap, before Nest builds the module graph, so a
// misconfigured deploy fails loudly at start instead of at the first login
// attempt.
type ProductionRequirement = {
  name: string;
  reason: string;
  isSatisfied: (env: NodeJS.ProcessEnv) => boolean;
};

const PRODUCTION_REQUIREMENTS: ProductionRequirement[] = [
  {
    name: "TURNSTILE_SECRET_KEY",
    reason:
      "captcha verification is skipped entirely when unset, leaving the login routes with no bot control",
    isSatisfied: (env) => Boolean(env.TURNSTILE_SECRET_KEY?.trim()),
  },
  {
    name: "REDIS_URL",
    reason:
      "rate-limit counters fall back to process memory, so they reset on every deploy and are not shared between instances",
    isSatisfied: (env) => Boolean(env.REDIS_URL?.trim()),
  },
  {
    name: "SESSION_SECRET",
    reason: "session and CSRF token signing depends on it",
    isSatisfied: (env) => Boolean(env.SESSION_SECRET?.trim()),
  },
  {
    name: "TOTP_ENCRYPTION_KEY",
    reason:
      "the platform owner's TOTP secret is stored in the clear without it, so any database read hands over a permanent code generator for the account that reaches every tenant (32 bytes, base64 or hex)",
    isSatisfied: (env) => isSecretKeyValid(env.TOTP_ENCRYPTION_KEY),
  },
  {
    name: "TRUST_PROXY_HOPS",
    reason:
      "without it Express reads request.ip as the proxy's address, so every request shares one rate-limit bucket — see resolveTrustProxyHops for how to count the hops for your deployment",
    isSatisfied: (env) => {
      const parsed = Number(env.TRUST_PROXY_HOPS?.trim());

      return Number.isInteger(parsed) && parsed >= 0;
    },
  },
];

export function collectSecurityConfigurationErrors(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }

  const errors = PRODUCTION_REQUIREMENTS.filter(
    (requirement) => !requirement.isSatisfied(env),
  ).map(
    (requirement) =>
      `${requirement.name} is required in production: ${requirement.reason}.`,
  );

  // A test-only escape hatch reaching production would disable every per-IP
  // limit and the per-account backoff at once, without any other symptom.
  if (env.RATE_LIMIT_DISABLED?.trim() === "true") {
    errors.push(
      "RATE_LIMIT_DISABLED must not be set in production: it turns off every auth rate limit and the per-account backoff.",
    );
  }

  return errors;
}

export function assertSecurityConfiguration(
  logger?: LoggerService,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const errors = collectSecurityConfigurationErrors(env);

  if (errors.length === 0) {
    return;
  }

  const message = `Refusing to start with an insecure configuration:\n- ${errors.join("\n- ")}`;

  logger?.error?.(message, "SecurityConfig");

  throw new Error(message);
}
