import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { config } from "../apps/web/proxy";

// The proxy is the only place the nonce-based Content-Security-Policy is set
// (next.config.ts carries the static headers; a nonce cannot be static), so a
// path the matcher skips is a page served with no policy at all.
//
// Compiled the way Next applies a regex matcher: anchored at both ends
// against the pathname.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher (which paths get a CSP)", () => {
  it("covers a tenant slug containing a dot", () => {
    // The bug this pins: the old pattern excluded any path with a dot
    // anywhere, and nothing constrains the shape of [tenantSlug]. The session
    // cookie decides what is served, so `/acme.x/field` rendered the real
    // field zone — with no policy and no nonce.
    assert.ok(matcher.test("/acme.x/field"));
    assert.ok(matcher.test("/acme.x"));
    assert.ok(matcher.test("/a.b.c/manager/visits"));
  });

  it("covers the ordinary application, marketing and platform paths", () => {
    for (const pathname of [
      "/",
      "/en",
      "/mg",
      "/mg/field",
      "/mg/manager/visits",
      "/mg/invites/accept",
      "/platform/login",
      "/platform/tenants",
    ]) {
      assert.ok(matcher.test(pathname), `expected ${pathname} to be covered`);
    }
  });

  it("skips the build output and every file shipped in public/", () => {
    for (const pathname of [
      "/_next/static/chunks/main.js",
      "/_next/image",
      // A nonce policy on this one would break it: its inline <script> is
      // hand-written and can never carry a nonce.
      "/offline.html",
      "/sw.js",
      "/icon.svg",
      "/icon-192.png",
      "/icon-512.png",
      "/apple-touch-icon.png",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/robots.txt",
      "/sitemap.xml",
    ]) {
      assert.equal(
        matcher.test(pathname),
        false,
        `expected ${pathname} to be skipped`,
      );
    }
  });

  it("still skips a path whose last segment ends in an extension, which is why the slug is validated too", () => {
    // The residual hole after the matcher fix: `/team.html` is a whole path
    // ending in a known extension, so it is skipped and arrives with no
    // policy. A matcher cannot tell that apart from a real asset — `sw.js`
    // has to stay skipped — so the second line is the tenant layout, which
    // 404s anything that is not slug-shaped and therefore never renders the
    // app under one of these. See tests/web-tenant-slug-shape.test.ts.
    assert.equal(matcher.test("/team.html"), false);
    assert.equal(matcher.test("/acme.js"), false);

    // A dot mid-path is still covered, so a nested route under a dotted
    // segment keeps its policy even before the layout refuses it.
    assert.ok(matcher.test("/acme.js/login"));
  });

  it("only treats a trailing extension as an extension", () => {
    // The anchoring is the whole fix: a dot inside a segment must not opt a
    // page out, while a genuine asset still does.
    assert.ok(matcher.test("/mg/reports/2026.q1"));
    assert.ok(matcher.test("/mg.png/field"));
    assert.equal(matcher.test("/mg/field/chart.png"), false);
  });
});
