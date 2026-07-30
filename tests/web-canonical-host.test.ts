import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalRedirectUrl } from "../apps/web/lib/canonical-host";
import { SITE_URL } from "../apps/web/lib/site";

describe("canonicalRedirectUrl", () => {
  it("forwards the production Vercel alias to the owned domain", () => {
    assert.equal(
      canonicalRedirectUrl("vizitum-web.vercel.app", "/mg/field"),
      "https://www.vizitum.com/mg/field",
    );
  });

  it("keeps the path and query, so an already-sent invite link still works", () => {
    assert.equal(
      canonicalRedirectUrl(
        "vizitum-web.vercel.app",
        "/mg/invites/accept?token=abc123",
      ),
      "https://www.vizitum.com/mg/invites/accept?token=abc123",
    );
  });

  it("forwards the apex, which the hosting layer is not the only guard for", () => {
    assert.equal(
      canonicalRedirectUrl("vizitum.com", "/en"),
      "https://www.vizitum.com/en",
    );
  });

  it("serves the canonical host itself rather than looping", () => {
    assert.equal(canonicalRedirectUrl("www.vizitum.com", "/mg/field"), null);
  });

  it("leaves preview deployments serving themselves", () => {
    assert.equal(
      canonicalRedirectUrl(
        "vizitum-web-git-feat-thing-kyi.vercel.app",
        "/mg/field",
      ),
      null,
    );
    assert.equal(
      canonicalRedirectUrl("vizitum-web-9a3d84e3.vercel.app", "/mg/field"),
      null,
    );
  });

  it("leaves local development and e2e hosts alone, port and all", () => {
    for (const host of [
      "localhost:3000",
      "127.0.0.1:3100",
      "localhost",
      "127.0.0.1",
    ]) {
      assert.equal(canonicalRedirectUrl(host, "/mg/field"), null);
    }
  });

  it("matches the redirected hosts case-insensitively and past a port", () => {
    assert.equal(
      canonicalRedirectUrl("Vizitum-Web.Vercel.App:443", "/mg/field"),
      "https://www.vizitum.com/mg/field",
    );
  });

  it("does nothing without a Host header rather than guessing an origin", () => {
    assert.equal(canonicalRedirectUrl(null, "/mg/field"), null);
    assert.equal(canonicalRedirectUrl(undefined, "/mg/field"), null);
    assert.equal(canonicalRedirectUrl("", "/mg/field"), null);
  });

  it("redirects to the same origin the SEO surfaces call canonical", () => {
    assert.equal(
      canonicalRedirectUrl("vizitum-web.vercel.app", "/"),
      `${SITE_URL}/`,
    );
  });
});
