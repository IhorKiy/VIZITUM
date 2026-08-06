import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSecurityConfiguration,
  collectSecurityConfigurationErrors,
} from "../src/modules/auth/security-config";

const COMPLETE_PRODUCTION_ENV = {
  NODE_ENV: "production",
  COOKIE_SECURE: "true",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  REDIS_URL: "redis://redis:6379",
  SESSION_SECRET: "session-secret",
  // 32 bytes, base64 — the gate checks the key is usable, not merely present.
  TOTP_ENCRYPTION_KEY: "dml6aXR1bS10ZXN0LXRvdHAta2V5LTMyLWJ5dGVzISE=",
  TRUST_PROXY_HOPS: "2",
  S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  S3_BUCKET: "vizitum",
  S3_ACCESS_KEY_ID: "access-key-id",
  S3_SECRET_ACCESS_KEY: "secret-access-key",
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
    "COOKIE_SECURE",
    "TURNSTILE_SECRET_KEY",
    "REDIS_URL",
    "SESSION_SECRET",
    "TOTP_ENCRYPTION_KEY",
    "TRUST_PROXY_HOPS",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
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

  it('rejects any COOKIE_SECURE value other than "true"', () => {
    // Anything short of the exact literal must refuse to start rather than
    // guess — "false", "0" or a stray typo are all closer to "cookies go out
    // without Secure in production" than to a deliberate choice. Matches the
    // existing RATE_LIMIT_DISABLED check above: trimmed, but not
    // case-folded, so only a dashboard's surrounding whitespace is forgiven.
    for (const value of ["false", "0", "TRUE"]) {
      const errors = collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        COOKIE_SECURE: value,
      } as NodeJS.ProcessEnv);

      assert.equal(errors.length, 1, `expected "${value}" to be refused`);
      assert.match(errors[0], /COOKIE_SECURE/);
    }
  });

  it("forgives surrounding whitespace around COOKIE_SECURE", () => {
    assert.deepEqual(
      collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        COOKIE_SECURE: " true ",
      } as NodeJS.ProcessEnv),
      [],
    );
  });

  it('refuses to start in production with EMAIL_PROVIDER="console"', () => {
    // That driver writes the whole email to the log, including invite and
    // password-reset links with their one-time tokens. Its own comment says
    // never to deploy it; this is that instruction somewhere a deploy runs
    // into it.
    const errors = collectSecurityConfigurationErrors({
      ...COMPLETE_PRODUCTION_ENV,
      EMAIL_PROVIDER: "console",
    } as NodeJS.ProcessEnv);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /EMAIL_PROVIDER/);

    // Case and spacing are how it would actually be mistyped into a
    // dashboard field.
    assert.equal(
      collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        EMAIL_PROVIDER: "  Console  ",
      } as NodeJS.ProcessEnv).length,
      1,
    );

    // The provider that should be there raises nothing.
    assert.deepEqual(
      collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        EMAIL_PROVIDER: "resend",
      } as NodeJS.ProcessEnv),
      [],
    );
  });

  it("reports every problem at once rather than one per restart", () => {
    const errors = collectSecurityConfigurationErrors({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    // One per production requirement, pinned to the list itself so adding a
    // requirement without a test for it is a failure rather than a silent
    // pass.
    assert.equal(errors.length, 10);
  });

  // The failure audit F2 recorded, and the reason presence alone is not
  // enough: the endpoint is not parsed anywhere until `buildObjectUrl` calls
  // `new URL` on the first upload, so a scheme-less value boots green, passes
  // readiness and `alerts:check`, and then 500s every audio and photo register
  // call with `TypeError: Invalid URL` while nothing pages anyone.
  it("refuses an S3 endpoint that is present but not a usable URL", () => {
    for (const endpoint of [
      // The paste error itself.
      "account.r2.cloudflarestorage.com",
      // `new URL` accepts this — protocol `r2:` — so parsing alone would let
      // it through and fail at the first upload anyway.
      "r2:account",
      "   ",
      "/account",
    ]) {
      const errors = collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        S3_ENDPOINT: endpoint,
      } as NodeJS.ProcessEnv);

      assert.equal(errors.length, 1, `expected "${endpoint}" to be refused`);
      assert.match(errors[0], /S3_ENDPOINT/);
    }
  });

  it("accepts an http endpoint, which is how a local S3 mock is reached", () => {
    assert.deepEqual(
      collectSecurityConfigurationErrors({
        ...COMPLETE_PRODUCTION_ENV,
        S3_ENDPOINT: "http://localhost:9000",
      } as NodeJS.ProcessEnv),
      [],
    );
  });
});
