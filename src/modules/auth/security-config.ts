import type { LoggerService } from "@nestjs/common";

import { isSecretKeyValid } from "../../common/secret-box";
import { isUsableStorageEndpoint } from "../storage/storage.config";

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
    name: "COOKIE_SECURE",
    reason:
      'session and CSRF cookies drive their "Secure" flag from this rather than from NODE_ENV — production once ran with NODE_ENV unset, which sent them without Secure and nothing surfaced it — so an unset or non-"true" value here would repeat exactly that silently',
    isSatisfied: (env) => env.COOKIE_SECURE?.trim() === "true",
  },
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
  // The four storage variables. These do not degrade silently the way the ones
  // above do — they throw — but they throw at the *first upload* rather than at
  // boot, which lands in the same place: `/health/readiness` reports ready,
  // UptimeRobot stays green, `npm run alerts:check` passes, and every
  // `POST /visits/:id/notes/audio/register` answers 500. Field representatives
  // lose audio and photo capture entirely, nothing pages anyone, and the first
  // report is a rep saying the button does not work (audit F2). Readiness does
  // not cover storage either, so this gate is the only thing that can catch it
  // before a person does.
  {
    name: "S3_ENDPOINT",
    reason:
      "storage is read per request and only checked for presence, so an endpoint with no scheme (`r2.example.com` rather than `https://r2.example.com`) boots green and then fails every media upload with `TypeError: Invalid URL` — it must parse as an http(s) URL",
    isSatisfied: (env) => isUsableStorageEndpoint(env.S3_ENDPOINT),
  },
  {
    name: "S3_BUCKET",
    reason:
      "every visit photo and audio note is written to it; unset, the first capture of the deploy is the thing that finds out",
    isSatisfied: (env) => Boolean(env.S3_BUCKET?.trim()),
  },
  {
    name: "S3_ACCESS_KEY_ID",
    reason:
      "presigned upload and download URLs cannot be signed without it, so media capture fails with no other symptom",
    isSatisfied: (env) => Boolean(env.S3_ACCESS_KEY_ID?.trim()),
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    reason:
      "presigned upload and download URLs cannot be signed without it, so media capture fails with no other symptom",
    isSatisfied: (env) => Boolean(env.S3_SECRET_ACCESS_KEY?.trim()),
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
