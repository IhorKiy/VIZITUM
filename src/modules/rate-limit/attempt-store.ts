import type Redis from "ioredis";

// Counter used for failed-credential tracking. Deliberately narrower than
// ThrottlerStorage: the per-account control needs only "how many failures has
// this identity had lately", with a sliding window that a persistent guesser
// keeps alive and an honest user lets lapse.
export interface AttemptStore {
  increment(key: string, windowSeconds: number): Promise<number>;
  reset(key: string): Promise<void>;
}

// Bounded so a flood of distinct keys (one per guessed email) cannot grow the
// map without limit. Well above the number of accounts any single tenant has
// failing logins at once.
const MAX_MEMORY_KEYS = 10_000;

export class MemoryAttemptStore implements AttemptStore {
  private readonly counters = new Map<
    string,
    { count: number; expiresAtMs: number }
  >();

  // Promise-returning to satisfy AttemptStore, though a Map needs no await.
  increment(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    const count =
      existing && existing.expiresAtMs > now ? existing.count + 1 : 1;

    this.counters.set(key, {
      count,
      expiresAtMs: now + windowSeconds * 1_000,
    });

    if (this.counters.size > MAX_MEMORY_KEYS) {
      this.prune(now);
    }

    return Promise.resolve(count);
  }

  reset(key: string): Promise<void> {
    this.counters.delete(key);

    return Promise.resolve();
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.expiresAtMs <= nowMs) {
        this.counters.delete(key);
      }
    }

    // Everything was still live: drop the oldest half rather than keep
    // growing. Losing counters only ever makes the delay shorter, never
    // denies anyone, so shedding under pressure is the safe direction.
    if (this.counters.size > MAX_MEMORY_KEYS) {
      const excess = this.counters.size - Math.floor(MAX_MEMORY_KEYS / 2);
      let dropped = 0;

      for (const key of this.counters.keys()) {
        this.counters.delete(key);
        dropped += 1;

        if (dropped >= excess) {
          break;
        }
      }
    }
  }
}

export class RedisAttemptStore implements AttemptStore {
  constructor(
    private readonly redis: Redis,
    private readonly fallback: AttemptStore = new MemoryAttemptStore(),
  ) {}

  async increment(key: string, windowSeconds: number): Promise<number> {
    try {
      // TTL is refreshed on every hit, which is what makes the window slide:
      // a guesser who keeps trying stays throttled, while a user who stops
      // ages out cleanly.
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();
      const incremented = results?.[0]?.[1];

      if (typeof incremented === "number") {
        return incremented;
      }

      return this.fallback.increment(key, windowSeconds);
    } catch {
      // A Redis outage must not break signing in. Degrading to this
      // process's memory keeps the control working (weaker, per-instance)
      // instead of turning it off; the connection error is already logged by
      // the client's error handler.
      return this.fallback.increment(key, windowSeconds);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Same reasoning: a failed reset only leaves a stale counter, which
      // expires on its own.
    }

    await this.fallback.reset(key);
  }
}

export function createAttemptStore(redis: Redis | null): AttemptStore {
  return redis ? new RedisAttemptStore(redis) : new MemoryAttemptStore();
}
