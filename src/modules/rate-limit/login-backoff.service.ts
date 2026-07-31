import { Inject, Injectable } from "@nestjs/common";

import { hashValue } from "../auth/auth-crypto";
import { ATTEMPT_STORE } from "./rate-limit.tokens";
import type { AttemptStore } from "./attempt-store";
import { LOGIN_BACKOFF, isRateLimitDisabled } from "./rate-limit.constants";

// Which credential surface a failure belongs to. Kept separate so failures
// against a tenant login never slow the platform login for the same address,
// and vice versa.
export type BackoffScope =
  "tenant-login" | "platform-login" | "password-change";

// Delay earned by `failureCount` consecutive recent failures. Pure and
// exported so the curve can be asserted directly, without a test that waits.
export function backoffDelayMs(failureCount: number): number {
  const penalized = failureCount - LOGIN_BACKOFF.freeAttempts;

  if (penalized <= 0) {
    return 0;
  }

  return Math.min(
    LOGIN_BACKOFF.maxDelayMs,
    LOGIN_BACKOFF.baseDelayMs * 2 ** (penalized - 1),
  );
}

// Per-account brake on credential guessing.
//
// This is a delay, never a refusal: see the reasoning in
// rate-limit.constants.ts — a hard per-email lockout hands an attacker the
// ability to lock any account they can name, the platform owner's included.
// The per-IP throttle is the control that actually refuses; this one only
// makes each guess against a given identity progressively more expensive.
//
// The delay is charged on the failure path only, so a user who types the
// right password is never held up, however many times they fumbled first.
@Injectable()
export class LoginBackoffService {
  constructor(@Inject(ATTEMPT_STORE) private readonly store: AttemptStore) {}

  // Records a failed credential check and holds the response for the delay
  // the identity has earned. Returns the delay for logging/tests.
  async penalizeFailure(
    scope: BackoffScope,
    identity: string,
  ): Promise<number> {
    if (isRateLimitDisabled()) {
      return 0;
    }

    const failures = await this.store.increment(
      buildKey(scope, identity),
      LOGIN_BACKOFF.windowSeconds,
    );
    const delayMs = backoffDelayMs(failures);

    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    return delayMs;
  }

  async clearFailures(scope: BackoffScope, identity: string): Promise<void> {
    await this.store.reset(buildKey(scope, identity));
  }

  // Overridden in tests so the curve can be exercised without real waiting.
  protected sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}

// The identity is an email address. Hashed before it becomes a key so the
// counter store never holds a readable list of the addresses people are
// failing to log into — Redis here is infrastructure, not a place for
// personal data.
function buildKey(scope: BackoffScope, identity: string): string {
  return `vizitum:login-backoff:${scope}:${hashValue(identity.trim().toLowerCase())}`;
}
