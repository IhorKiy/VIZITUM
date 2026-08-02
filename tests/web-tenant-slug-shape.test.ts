import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTenantSlug,
  normalizeTenantSlug,
} from "../apps/web/lib/tenant-locale";

// Nothing constrained the shape of the `[tenantSlug]` segment, and what gets
// served under it is decided by the session cookie rather than by the slug —
// so any string at all rendered the real, authenticated app. Two consequences
// followed: a slug ending in a static-file extension (`/team.html`) arrived
// with no Content-Security-Policy, because the proxy matcher skips those
// paths; and the same unchecked segment fed the `redirect()` targets pages
// build from it.
//
// The tenant layout now turns anything that is not slug-shaped into a 404.
describe("tenant slug shape", () => {
  it("accepts the shape a workspace address can actually have", () => {
    for (const slug of ["mg", "demo-team", "e2e-field-media", "tz-test-co"]) {
      assert.equal(normalizeTenantSlug(slug), slug);
    }
  });

  it("keeps resolving a link that shouts the slug", () => {
    // Trim-and-lowercase mirrors the API's own normalizeSlug, so "/MG/login"
    // has always reached the workspace. Rejecting it here would have been a
    // regression dressed as a security fix.
    assert.equal(normalizeTenantSlug("MG"), "mg");
    assert.equal(normalizeTenantSlug("  Demo-Team  "), "demo-team");
  });

  it("rejects everything that is not a slug", () => {
    for (const value of [
      // The CSP hole: a path ending in an extension the proxy matcher skips.
      "team.html",
      "acme.js",
      "acme.x",
      // The redirect hole: browsers normalize a backslash into a path
      // separator, so this becomes a protocol-relative cross-origin URL.
      "\\evil.com",
      "/evil.com",
      "..",
      "-leading-dash",
      "trailing space ",
      "under_score",
      "",
      "   ",
    ]) {
      assert.equal(
        normalizeTenantSlug(value),
        null,
        `expected ${JSON.stringify(value)} to name no workspace`,
      );
    }
  });

  it("is the same rule the rest of the frontend already applies", () => {
    // The workspace entry screen, the remembered workspace and the zone
    // actions all gate on isTenantSlug. The layout was the one door without
    // it, which is why this normalizes onto that predicate rather than
    // introducing a second definition of "slug".
    assert.equal(isTenantSlug("demo-team"), true);
    assert.equal(isTenantSlug("team.html"), false);
    assert.equal(normalizeTenantSlug("TEAM.HTML"), null);
  });

  it("says nothing about the static segments, which never reach the layout", () => {
    // `/platform`, `/en` and `/sign-in` are static routes that shadow the
    // dynamic segment, so this predicate is never asked about them — and it
    // would answer "valid shape" if it were, which is why the exclusion lives
    // in the router rather than here.
    for (const segment of ["platform", "en", "sign-in"]) {
      assert.equal(normalizeTenantSlug(segment), segment);
    }
  });
});
