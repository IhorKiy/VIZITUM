import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { HttpException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerStorageService } from "@nestjs/throttler";

import { ApiThrottlerGuard } from "../src/modules/rate-limit/api-throttler.guard";
import { MemoryAttemptStore } from "../src/modules/rate-limit/attempt-store";
import { backoffDelayMs } from "../src/modules/rate-limit/login-backoff.service";
import {
  LOGIN_BACKOFF,
  LOGIN_THROTTLE,
  isRateLimitDisabled,
  resolveTrustProxyHops,
} from "../src/modules/rate-limit/rate-limit.constants";
import { TestLoginBackoffService } from "./fixtures/login-backoff";

// Nest DI is bypassed throughout: the suite runs under tsx, which never emits
// the design:paramtypes metadata Nest needs (see CLAUDE.md), so the guard is
// constructed by hand with the same three dependencies the container would
// supply.
// The in-memory storage schedules a timer per window, which would hold the
// test process open for the full TTL. Every guard built here is registered so
// afterEach can shut its storage down.
const openStorages: ThrottlerStorageService[] = [];

function createGuard(limit: number, ttlSeconds: number) {
  const storage = new ThrottlerStorageService();

  openStorages.push(storage);

  return new ApiThrottlerGuard(
    { throttlers: [{ name: "default", limit, ttl: ttlSeconds * 1_000 }] },
    storage,
    new Reflector(),
  );
}

function closeStorages() {
  while (openStorages.length > 0) {
    openStorages.pop()?.onApplicationShutdown();
  }
}

function createContext(ip: string) {
  const headers: Record<string, unknown> = {};
  const handler = function loginHandler() {};
  const classRef = class LoginController {};

  return {
    context: {
      getHandler: () => handler,
      getClass: () => classRef,
      switchToHttp: () => ({
        getRequest: () => ({ ip, headers: {}, socket: {} }),
        getResponse: () => ({
          header: (name: string, value: unknown) => {
            headers[name] = value;
          },
        }),
      }),
    } as never,
    headers,
  };
}

describe("auth rate limiting", () => {
  afterEach(() => {
    closeStorages();
    delete process.env.RATE_LIMIT_DISABLED;
    delete process.env.TRUST_PROXY_HOPS;
  });

  it("rejects the attempt past the per-IP login limit with 429", async () => {
    const limit = 5;
    const guard = createGuard(limit, 60);
    await guard.onModuleInit();

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const { context } = createContext("203.0.113.10");
      assert.equal(
        await guard.canActivate(context),
        true,
        `attempt ${attempt} within the limit should pass`,
      );
    }

    const { context, headers } = createContext("203.0.113.10");
    let thrown: unknown;

    try {
      await guard.canActivate(context);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof HttpException, "expected a rejection");
    assert.equal(thrown.getStatus(), 429);
    assert.equal(
      (thrown.getResponse() as { code?: string }).code,
      "RATE_LIMITED",
    );
    assert.ok(
      Number(headers["Retry-After"]) > 0,
      "a Retry-After header tells the caller when to come back",
    );
  });

  it("keys the limit per client address, so one attacker cannot lock out everyone", async () => {
    const guard = createGuard(2, 60);
    await guard.onModuleInit();

    await guard.canActivate(createContext("203.0.113.10").context);
    await guard.canActivate(createContext("203.0.113.10").context);
    await assert.rejects(() =>
      guard.canActivate(createContext("203.0.113.10").context),
    );

    // A different address still has its full allowance.
    assert.equal(
      await guard.canActivate(createContext("198.51.100.20").context),
      true,
    );
  });

  it("is switched off entirely by RATE_LIMIT_DISABLED, for the e2e suite only", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";

    const guard = createGuard(1, 60);
    await guard.onModuleInit();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal(
        await guard.canActivate(createContext("203.0.113.10").context),
        true,
      );
    }

    assert.equal(isRateLimitDisabled(), true);
  });

  it("keeps the tenant login limit generous enough for an office behind one address", () => {
    // A shared egress IP is the normal case, not the attack case. The cap
    // still bounds a scripted loop; this pins that it was not set so low that
    // a real team trips it.
    assert.ok(LOGIN_THROTTLE.limit >= 20);
    assert.equal(LOGIN_THROTTLE.ttlSeconds, 60);
  });
});

describe("per-account login backoff", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_DISABLED;
  });

  it("costs nothing for the first few failures, then grows", () => {
    for (let failures = 1; failures <= LOGIN_BACKOFF.freeAttempts; failures += 1) {
      assert.equal(
        backoffDelayMs(failures),
        0,
        `failure ${failures} is within the free allowance`,
      );
    }

    assert.equal(backoffDelayMs(LOGIN_BACKOFF.freeAttempts + 1), 1_000);
    assert.equal(backoffDelayMs(LOGIN_BACKOFF.freeAttempts + 2), 2_000);
    assert.equal(backoffDelayMs(LOGIN_BACKOFF.freeAttempts + 3), 4_000);
    assert.equal(backoffDelayMs(LOGIN_BACKOFF.freeAttempts + 4), 8_000);
  });

  it("caps the delay instead of growing without bound", () => {
    // The delay is paid by holding the request open, so an unbounded ramp
    // would let a guesser tie up connections — and it must never become an
    // effective lockout.
    assert.equal(backoffDelayMs(100), LOGIN_BACKOFF.maxDelayMs);
    assert.ok(LOGIN_BACKOFF.maxDelayMs <= 60_000);
  });

  it("delays repeated failures against one account but never denies them", async () => {
    const backoff = new TestLoginBackoffService();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      // Resolves every time: the control is a delay, not a refusal. A hard
      // per-email lockout would let anyone lock out an account they can name.
      await backoff.penalizeFailure("tenant-login", "victim@example.com");
    }

    const delays = backoff.delays.map((entry) => entry.delayMs);

    assert.deepEqual(delays.slice(0, LOGIN_BACKOFF.freeAttempts), [0, 0, 0]);
    assert.ok(
      delays[delays.length - 1] > delays[LOGIN_BACKOFF.freeAttempts],
      "later failures cost more than earlier ones",
    );
    assert.ok(
      delays.every((delay) => delay <= LOGIN_BACKOFF.maxDelayMs),
      "no delay exceeds the cap",
    );
  });

  it("clears the debt on a correct password, so the real user is never slowed", async () => {
    const backoff = new TestLoginBackoffService();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await backoff.penalizeFailure("tenant-login", "user@example.com");
    }

    assert.ok(backoff.delays[5].delayMs > 0);

    await backoff.clearFailures("tenant-login", "user@example.com");
    await backoff.penalizeFailure("tenant-login", "user@example.com");

    assert.equal(
      backoff.delays[6].delayMs,
      0,
      "the counter restarted from zero",
    );
  });

  it("keeps tenant and platform failures on separate counters", async () => {
    const backoff = new TestLoginBackoffService();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await backoff.penalizeFailure("tenant-login", "owner@example.com");
    }

    await backoff.penalizeFailure("platform-login", "owner@example.com");

    assert.equal(
      backoff.delays[6].delayMs,
      0,
      "failures against the tenant login must not slow the platform login",
    );
  });

  it("never stores the address it is counting failures for", async () => {
    const store = new MemoryAttemptStore();
    const seenKeys: string[] = [];
    const recordingStore = {
      increment: (key: string, windowSeconds: number) => {
        seenKeys.push(key);
        return store.increment(key, windowSeconds);
      },
      reset: (key: string) => store.reset(key),
    };
    const backoff = new TestLoginBackoffService(recordingStore);

    await backoff.penalizeFailure("tenant-login", "person@example.com");

    assert.equal(seenKeys.length, 1);
    assert.ok(
      !seenKeys[0].includes("person@example.com"),
      "the counter key is hashed, so Redis holds no readable list of addresses",
    );
  });

  it("does nothing while rate limiting is switched off", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";

    const backoff = new TestLoginBackoffService();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await backoff.penalizeFailure("tenant-login", "user@example.com");
    }

    assert.ok(backoff.delays.every((entry) => entry.delayMs === 0));
  });
});

describe("trust proxy configuration", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
  });

  it("trusts nothing unless the hop count is stated", () => {
    assert.equal(resolveTrustProxyHops({} as NodeJS.ProcessEnv), 0);
    assert.equal(
      resolveTrustProxyHops({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
      0,
      "production has no safe default — security-config.ts refuses to boot without one",
    );
  });

  it("reads an explicit hop count", () => {
    assert.equal(
      resolveTrustProxyHops({ TRUST_PROXY_HOPS: "2" } as NodeJS.ProcessEnv),
      2,
    );
  });

  it("ignores a nonsense hop count rather than trusting a bad value", () => {
    // `true` here would mean "trust every hop", which lets any client forge
    // its own address with X-Forwarded-For.
    assert.equal(
      resolveTrustProxyHops({ TRUST_PROXY_HOPS: "true" } as NodeJS.ProcessEnv),
      0,
    );
    assert.equal(
      resolveTrustProxyHops({ TRUST_PROXY_HOPS: "-1" } as NodeJS.ProcessEnv),
      0,
    );
  });
});
