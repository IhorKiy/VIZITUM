import assert from "node:assert/strict";
import { describe, it } from "node:test";

// COOKIE_SECURE is read once at module load into a top-level const, not
// per-request — so unlike security-config.ts's boot gate (which takes an
// injectable env and can be exercised directly), the only way to pin what
// the actual cookie flag resolves to is a fresh dynamic import with the env
// var set first. Static imports are hoisted ahead of any top-level code in
// this file, so setting process.env before importing only works via
// `await import(...)`.
//
// This exists because the boot gate and the flag itself disagreed: the gate
// trimmed whitespace before comparing to "true", the flag did not, so a
// dashboard value like " true " (trailing space) passed the gate and booted
// production with `secure: false` — quieter than the NODE_ENV bug this item
// was fixing, not louder, since nothing failed until the __Host- prefixed
// Set-Cookie was silently refused by the browser.
describe("COOKIE_SECURE resolution at module load", () => {
  it("treats a whitespace-padded value the same as the boot gate does", async () => {
    process.env.COOKIE_SECURE = " true ";

    const { COOKIE_OPTIONS, CSRF_COOKIE_OPTIONS } = await import(
      "../src/modules/auth/auth.constants"
    );

    assert.equal(COOKIE_OPTIONS.secure, true);
    assert.equal(CSRF_COOKIE_OPTIONS.secure, true);
  });
});
