import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { apiErrorMessageKey } from "../apps/web/lib/api-error";
import enMessages from "../apps/web/messages/en.json";
import ukMessages from "../apps/web/messages/uk.json";

// `apps/web/lib/api-error.ts` — the code→key map that keeps the backend's
// English off a translated screen. 25 sites render `someResult.message`
// verbatim beneath a next-intl heading, so a Ukrainian tenant reads
// "Authentication is required." under a Ukrainian title, and
// `npm run web:i18n:check` cannot see it: that script looks for Cyrillic
// *literals*, and these are English values arriving at runtime (audit F14).
//
// The shape is `lib/login-error.ts`'s, and the same test shape applies: pin
// the known codes, and pin that everything else collapses onto one fallback
// rather than growing a second way to say "unknown".

describe("apiErrorMessageKey", () => {
  it("maps the codes any authenticated request can meet", () => {
    assert.equal(
      apiErrorMessageKey("AUTHENTICATION_REQUIRED"),
      "authenticationRequired",
    );
    assert.equal(apiErrorMessageKey("MISSING_PERMISSION"), "permissionDenied");
  });

  it("keeps a workspace refusal apart from anything the caller did", () => {
    // The distinction lib/login-error.ts exists to preserve: these are thrown
    // before the request's own content is looked at, so reporting them as a
    // generic failure sends the reader off to fix something that is not wrong.
    for (const code of [
      "TENANT_NOT_READY",
      "TENANT_UNAVAILABLE",
      "TENANT_ARCHIVED",
    ]) {
      assert.equal(apiErrorMessageKey(code), "workspaceUnavailable", code);
    }
  });

  it("reads a CSRF refusal as a stale page, which is what it means to a reader", () => {
    for (const code of [
      "CSRF_TOKEN_INVALID",
      "CSRF_TOKEN_MALFORMED",
      "CSRF_TOKEN_REQUIRED",
    ]) {
      assert.equal(apiErrorMessageKey(code), "sessionExpired", code);
    }
  });

  it("names the field report's own refusals, which a rep can act on", () => {
    assert.equal(apiErrorMessageKey("VISIT_NOT_ACTIVE"), "visitNotActive");
    assert.equal(apiErrorMessageKey("REPORT_INVALID"), "reportInvalid");
    assert.equal(apiErrorMessageKey("PHOTO_UPLOAD_INVALID"), "photoInvalid");
  });

  it("collapses anything it does not know onto the one fallback", () => {
    // An unknown code is not a defect: the backend grows codes, and degrading
    // to "something went wrong" is the correct answer. What must never happen
    // is the English sentence reaching the screen instead.
    for (const code of [
      undefined,
      "",
      "SOME_FUTURE_CODE",
      "authentication_required",
      "AUTHENTICATION_REQUIRED ",
    ]) {
      assert.equal(apiErrorMessageKey(code), "unknown", String(code));
    }
  });

  it("has a translation for every key it can return, in both dictionaries", () => {
    // The failure this closes is silent in a specific way: a key with no
    // message renders as the raw key path, which looks like a bug in the copy
    // rather than a missing mapping.
    const source = readFileSync(
      path.join(import.meta.dirname, "../apps/web/lib/api-error.ts"),
      "utf8",
    );
    const declaration = source.slice(
      source.indexOf("export type ApiErrorMessageKey ="),
    );
    const keys = [
      ...declaration.slice(0, declaration.indexOf(";")).matchAll(/"(\w+)"/g),
    ].map(([, key]) => key);

    assert.ok(keys.length >= 8, `expected the union to parse, got ${keys}`);

    for (const key of keys) {
      assert.ok(
        key in enMessages.common.apiError,
        `en is missing common.apiError.${key}`,
      );
      assert.ok(
        key in ukMessages.common.apiError,
        `uk is missing common.apiError.${key}`,
      );
    }
  });
});
