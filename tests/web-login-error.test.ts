import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loginErrorMessageKey,
  loginErrorReason,
} from "../apps/web/lib/login-error";

// A refusal of the workspace and a refusal of the credentials have to read
// differently. TenancyService.assertTenantCanServeRequests throws
// TENANT_NOT_READY / TENANT_UNAVAILABLE before AuthService.login has looked at
// the password at all, so reporting either as "invalid email or password" sends
// the reader off to try passwords for a workspace that is switched off — which
// is exactly what happened to a staging tenant left on a legacy status after a
// migration.
describe("loginErrorReason", () => {
  it("separates a tenant that is not serving requests from bad credentials", () => {
    assert.equal(loginErrorReason("TENANT_NOT_READY"), "workspace");
    assert.equal(loginErrorReason("TENANT_UNAVAILABLE"), "workspace");
  });

  it("keeps the captcha failure distinct, since retrying it is the fix", () => {
    assert.equal(loginErrorReason("CAPTCHA_INVALID"), "captcha");
  });

  // The anti-enumeration guarantee: the API answers "no such user" and "wrong
  // password" with one code, and the screen must not reintroduce the difference.
  it("collapses every credential failure into one indistinguishable answer", () => {
    assert.equal(loginErrorReason("INVALID_CREDENTIALS"), "invalid");
  });

  it("collapses anything it does not recognize rather than leaking a new signal", () => {
    assert.equal(loginErrorReason("RATE_LIMITED"), "invalid");
    assert.equal(loginErrorReason("TENANT_NOT_FOUND"), "invalid");
    assert.equal(loginErrorReason("SOMETHING_NEW"), "invalid");
    // Non-JSON or bodyless error responses reach the mapping with no code.
    assert.equal(loginErrorReason(undefined), "invalid");
    assert.equal(loginErrorReason(""), "invalid");
  });

  it("matches the code exactly, so a lookalike is not treated as a tenant refusal", () => {
    assert.equal(loginErrorReason("tenant_not_ready"), "invalid");
    assert.equal(loginErrorReason("TENANT_NOT_READY_YET"), "invalid");
  });
});

describe("loginErrorMessageKey", () => {
  it("renders the workspace refusal with its own message", () => {
    assert.equal(
      loginErrorMessageKey("workspace"),
      "errorWorkspaceUnavailable",
    );
  });

  it("keeps the reasons the screen already had", () => {
    assert.equal(loginErrorMessageKey("network"), "errorNetwork");
    assert.equal(loginErrorMessageKey("captcha"), "errorCaptcha");
    assert.equal(loginErrorMessageKey("invalid"), "errorInvalid");
  });

  // The reason is read straight off the query string, so it is whatever the URL
  // carried: a hand-edited or stale value must still render an error, not an
  // empty alert box.
  it("falls back to the credential message for an unknown or absent reason", () => {
    assert.equal(loginErrorMessageKey(undefined), "errorInvalid");
    assert.equal(loginErrorMessageKey(""), "errorInvalid");
    assert.equal(loginErrorMessageKey("WORKSPACE"), "errorInvalid");
    assert.equal(loginErrorMessageKey("../../etc/passwd"), "errorInvalid");
  });
});

// Both halves have to agree, or a redirect lands on a reason the renderer does
// not know and the screen quietly says "invalid email or password" again.
describe("the two mappings compose", () => {
  it("carries each API code through to its own message", () => {
    const messageFor = (code: string | undefined) =>
      loginErrorMessageKey(loginErrorReason(code));

    assert.equal(messageFor("TENANT_NOT_READY"), "errorWorkspaceUnavailable");
    assert.equal(messageFor("TENANT_UNAVAILABLE"), "errorWorkspaceUnavailable");
    assert.equal(messageFor("CAPTCHA_INVALID"), "errorCaptcha");
    assert.equal(messageFor("INVALID_CREDENTIALS"), "errorInvalid");
  });
});
