/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately process-local. It exists to keep one client from hammering an
 * unauthenticated endpoint, not to enforce a cluster-wide quota: with more than
 * one API instance the effective limit multiplies by the instance count, which
 * is an acceptable ceiling for what it guards (password reset requests, whose
 * real protection is the per-account throttle in password-reset.service.ts and
 * the fact that the response never reveals whether an account exists). Moving
 * this to Redis is the upgrade path if a limit ever has to be exact.
 *
 * Entries are pruned lazily on each `consume` — a caller keyed by client IP
 * would otherwise leak an entry per address seen.
 */
export type RateLimiterOptions = {
  /** Requests allowed per key within `windowMs`. */
  limit: number;
  windowMs: number;
};

type Window = {
  count: number;
  resetAt: number;
};

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly options: RateLimiterOptions) {}

  /**
   * Records a hit against `key`. Returns false once the key is over its limit
   * for the current window — callers decide what "over" means for them, since
   * this endpoint answers 200 either way.
   */
  consume(key: string, now: number = Date.now()): boolean {
    this.prune(now);

    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.options.windowMs });

      return true;
    }

    existing.count += 1;

    return existing.count <= this.options.limit;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
