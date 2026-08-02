import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCookieName } from "../src/common/cookie-naming";

// Item 3.4 of the security remediation plan: shared by the tenant and
// platform cookie constants so the __Host- rule and the dev-only override
// can't drift between the two.
describe("resolveCookieName", () => {
  it("prefixes with __Host- in production, ignoring any override", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

    assert.equal(
      resolveCookieName("vizitum_session", undefined, env),
      "__Host-vizitum_session",
    );
    assert.equal(
      resolveCookieName("vizitum_session", "vizitum_session_wt5", env),
      "__Host-vizitum_session",
    );
  });

  it("uses the base name outside production when no override is set", () => {
    const env = {} as NodeJS.ProcessEnv;

    assert.equal(resolveCookieName("vizitum_csrf", undefined, env), "vizitum_csrf");
    assert.equal(
      resolveCookieName("vizitum_csrf", "", env),
      "vizitum_csrf",
    );
  });

  it("uses the dev override outside production when one is set", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

    assert.equal(
      resolveCookieName("vizitum_session", "vizitum_session_wt1", env),
      "vizitum_session_wt1",
    );
  });

  it("treats a blank override the same as no override", () => {
    const env = {} as NodeJS.ProcessEnv;

    assert.equal(
      resolveCookieName("vizitum_session", "   ", env),
      "vizitum_session",
    );
  });
});
