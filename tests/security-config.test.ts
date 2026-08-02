import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSecurityConfiguration,
  collectSecurityConfigurationErrors,
} from "../src/modules/auth/security-config";

const COMPLETE_PRODUCTION_ENV = {
  NODE_ENV: "production",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  REDIS_URL: "redis://redis:6379",
  SESSION_SECRET: "session-secret",
  // 32 bytes, base64 — the gate checks the key is usable, not merely present.
  TOTP_ENCRYPTION_KEY: "dml6aXR1bS10ZXN0LXRvdHAta2V5LTMyLWJ5dGVzISE=",
  TRUST_PROXY_HOPS: "2",
} as NodeJS.ProcessEnv;

describe("production security configuration", () => {
  it("accepts a fully configured production environment", () => {
    assert.deepEqual(
      collectSecurityConfigurationErrors(COMPLETE_PRODUCTION_ENV),
      [],
    );
  });

  it("leaves non-production environments alone", () => {
    // Local dev, tests and e2e must run without Cloudflare credentials or a
    // Redis instance — that is the whole reason these controls degrade
    // instead of erroring.
    assert.deepEqual(collectSecurityConfigurationErrors({} as NodeJS.ProcessEnv), []);
    assert.deepEqual(
      collectSecurityConfigurationErrors({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
      [],
    );
  });

  for (const missing of [
    "TURNSTILE_SECRET_KEY",
    "REDIS_URL",
    "SESSION_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "TRUST_PROXY_HOPS",
  ] as const) {
    it(`refuses to start in production without ${missing}`, () => {
      const env = { ...COMPLETE_PRODUCTION_ENV };
      delete env[missing];

      const errors = collectSecurityConfigurationErrors(env);

      assert.equal(errors.length, 1);
      assert.ok(errors[0].startsWith(`${missing} is required in production`));
      assert.throws(() => assertSecurityConfiguration(undefined, env), {
        message: new RegExp(missing),
      });
    });
  }

  it("refuses to start in production with rate limiting switched off", () => {
    // The e2e escape hatch reaching production would silently disable every
    // per-IP limit and the per-account backoff at once.
    const errors = collectSecurityConfigurationErrors({
      ...COMPLETE_PRODUCTION_ENV,
      RATE_LIMIT_DISABLED: "true",
    } as NodeJS.ProcessEnv);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /RATE_LIMIT_DISABLED must not be set/);
  });

  it("treats a blank value as missing", () => {
    const errors = collectSecurityConfigurationErrors({
      ...COMPLETE_PRODUCTION_ENV,
      TURNSTILE_SECRET_KEY: "   ",
    } as NodeJS.ProcessEnv);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /TURNSTILE_SECRET_KEY/);
  });

  it("rejects a non-numeric hop count instead of trusting every proxy", () => {
    const errors = collectSecurityConfigurationErrors({
      ...COMPLETE_PRODUCTION_ENV,
      TRUST_PROXY_HOPS: "true",
    } as NodeJS.ProcessEnv);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /TRUST_PROXY_HOPS/);
  });

  it("reports every problem at once rather than one per restart", () => {
    const errors = collectSecurityConfigurationErrors({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    // One per production requirement, pinned to the list itself so adding a
    // requirement without a test for it is a failure rather than a silent
    // pass.
    assert.equal(errors.length, 5);
  });
});
