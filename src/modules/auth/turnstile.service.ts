import { BadRequestException, Injectable, Logger } from "@nestjs/common";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare documents Turnstile response tokens as at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;

// Server-side verification of Cloudflare Turnstile captcha tokens for the
// login routes. The whole feature is driven by TURNSTILE_SECRET_KEY: when the
// variable is unset (local dev, e2e, tests) verification is a no-op, so no
// environment needs Cloudflare credentials to sign in.
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

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

    let success: boolean;

    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: secretKey,
          response: normalized,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`siteverify responded with ${response.status}`);
      }

      const outcome = (await response.json()) as {
        success?: unknown;
        "error-codes"?: unknown;
      };
      success = outcome.success === true;

      if (!success) {
        this.logger.warn(
          `Turnstile rejected a login token: ${JSON.stringify(
            outcome["error-codes"] ?? [],
          )}`,
        );
      }
    } catch (error) {
      // Fail open: Cloudflare being unreachable must not lock the whole team
      // out of the product — the password check still stands on its own.
      this.logger.warn(
        `Turnstile siteverify unavailable, allowing login: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (!success) {
      throwCaptchaInvalid();
    }
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
