import { BadRequestException, Injectable, Logger } from "@nestjs/common";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare documents Turnstile response tokens as at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;

// A login must never wait on Cloudflare for longer than this. Without it a
// hung connection holds the request open until the platform's own timeout.
const SITEVERIFY_TIMEOUT_MS = 3_000;

// Once siteverify proves unreachable, stop calling it for this long. The
// breaker is about latency, not policy: during an outage every login would
// otherwise pay the full timeout above before being let through anyway.
const CIRCUIT_OPEN_MS = 30_000;

// Server-side verification of Cloudflare Turnstile captcha tokens for the
// login routes. Driven by TURNSTILE_SECRET_KEY: when the variable is unset
// (local dev, e2e, tests) verification is a no-op, so no environment needs
// Cloudflare credentials to sign in. Production refuses to boot without it —
// see auth/security-config.ts — because that no-op is otherwise invisible.
//
// Two failure modes, deliberately handled in opposite directions:
//
//   * A *rejection* — siteverify answered, and the answer was not 2xx, or was
//     2xx with success:false — fails CLOSED. The service is reachable and is
//     telling us something is wrong with the request or the token; treating
//     that as "allow" is what made the old code fail open on any non-2xx.
//     (Trade-off: a 5xx or 429 from Cloudflare therefore blocks logins for as
//     long as it lasts. Accepted deliberately — the alternative lets anyone
//     who can degrade the response bypass the captcha entirely.)
//   * A *transport failure* — DNS, connection, timeout, i.e. no answer at all
//     — fails OPEN. Cloudflare being unreachable must not lock the whole team
//     out of the product; the password check still stands on its own.
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private circuitOpenUntilMs = 0;

  isEnabled(): boolean {
    return Boolean(readSecretKey());
  }

  async assertValidToken(token: unknown): Promise<void> {
    const secretKey = readSecretKey();

    if (!secretKey) {
      return;
    }

    const normalized = normalizeCaptchaToken(token);

    if (!normalized) {
      throwCaptchaInvalid();
    }

    if (Date.now() < this.circuitOpenUntilMs) {
      // Still inside the window opened by an earlier transport failure.
      // Allowing without a round trip is the same outcome the timeout would
      // reach, minus the wait.
      return;
    }

    let response: Response;

    try {
      response = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: secretKey,
          response: normalized,
        }).toString(),
        signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
      });
    } catch (error) {
      this.openCircuit(error);
      return;
    }

    if (!response.ok) {
      this.logger.warn(
        `Turnstile siteverify rejected the request with ${response.status}; refusing the login.`,
      );
      throwCaptchaInvalid();
    }

    let outcome: { success?: unknown; "error-codes"?: unknown };

    try {
      outcome = (await response.json()) as typeof outcome;
    } catch (error) {
      // A 2xx whose body is not the documented JSON is a rejection, not a
      // transport failure: the response arrived, it just isn't an approval.
      this.logger.warn(
        `Turnstile siteverify returned an unreadable body: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throwCaptchaInvalid();
    }

    // A successful round trip closes the breaker again.
    this.circuitOpenUntilMs = 0;

    if (outcome.success !== true) {
      this.logger.warn(
        `Turnstile rejected a login token: ${JSON.stringify(
          outcome["error-codes"] ?? [],
        )}`,
      );
      throwCaptchaInvalid();
    }
  }

  private openCircuit(error: unknown): void {
    this.circuitOpenUntilMs = Date.now() + CIRCUIT_OPEN_MS;

    this.logger.warn(
      `Turnstile siteverify unreachable, allowing login and pausing verification for ${
        CIRCUIT_OPEN_MS / 1_000
      }s: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSecretKey(): string | undefined {
  const value = process.env.TURNSTILE_SECRET_KEY?.trim();

  return value ? value : undefined;
}

function normalizeCaptchaToken(token: unknown): string | undefined {
  if (typeof token !== "string") {
    return undefined;
  }

  const trimmed = token.trim();

  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) {
    return undefined;
  }

  return trimmed;
}

function throwCaptchaInvalid(): never {
  throw new BadRequestException({
    code: "CAPTCHA_INVALID",
    message: "Captcha verification failed.",
  });
}
