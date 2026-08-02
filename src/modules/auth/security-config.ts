import type { LoggerService } from "@nestjs/common";

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

  // The console driver prints the whole email — including invite and
  // password-reset links with their one-time tokens — to the log. Its own
  // comment says never to deploy it; this is that instruction expressed
  // somewhere a deploy actually runs into.
  if (env.EMAIL_PROVIDER?.trim().toLowerCase() === "console") {
    errors.push(
      'EMAIL_PROVIDER must not be "console" in production: that driver writes every email, including one-time invite and password-reset tokens, to the application log.',
    );
  }

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
