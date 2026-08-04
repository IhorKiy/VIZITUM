import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import rootManifest from "../apps/web/app/manifest";
import { tenantStartUrl } from "../apps/web/lib/manifest";
import { WORKSPACE_ENTRY_PATHS } from "../apps/web/lib/workspace-address";

// A Home Screen install is the supported way to run the field zone offline —
// it is what exempts this app's IndexedDB from iOS's 7-day eviction of
// script-writable storage. Which makes the installed app's launch destination
// load-bearing in a way nothing else in the frontend is: get it wrong and the
// app launches somewhere with no offline shell behind it, with no address bar
// to recover through.
//
// What a right start_url does not buy is a cold offline launch: WebKit fails
// that navigation before the worker is consulted, so it shows the browser's
// error page regardless (iOS 18.7.9 — see apps/web/public/sw.js). What these
// assertions still protect is the warm case, where a full-page load inside
// the worker's scope does reach offline.html, and the shell's ability to
// recover the slug at all.
//
// Three files have to agree on it and none of them can import the others —
// the manifest is TypeScript in the Next app, the worker and the offline
// shell are plain files served as-is from public/. So they are read as text
// here, the way tests/input-limits.test.ts reads across the same boundary.
function readWebFile(relativePath: string): string {
  return readFileSync(
    path.join(process.cwd(), "apps/web", relativePath),
    "utf8",
  );
}

// The worker's own literal, not a copy of it: a regex retyped here would keep
// passing after sw.js narrowed its scope, which is exactly the drift this
// test exists to catch.
function readFieldZonePattern(): RegExp {
  const source = readWebFile("public/sw.js");
  const literal = source.match(/^const FIELD_ZONE_PATH = (\/.+\/);$/m)?.[1];

  assert.ok(
    literal,
    "FIELD_ZONE_PATH is no longer a plain regex literal in sw.js — this test " +
      "can no longer read the worker's real navigation scope, so update the " +
      "extraction rather than deleting the check.",
  );

  return new RegExp(literal.slice(1, -1));
}

describe("the installed tenant app's launch destination", () => {
  it("names the tenant, so the app opens the workspace it was installed from", () => {
    assert.equal(tenantStartUrl("vizitum-staging"), "/vizitum-staging/field");
  });

  it("sits inside the service worker's navigation fallback scope", () => {
    const fieldZonePath = readFieldZonePattern();

    assert.equal(fieldZonePath.test(tenantStartUrl("mg")), true);
    assert.equal(fieldZonePath.test(tenantStartUrl("vizitum-staging")), true);
  });

  it("puts the slug where the offline shell reads it from", () => {
    const offlineShell = readWebFile("public/offline.html");

    // offline.html runs outside the app's module graph and recovers the
    // tenant from the URL alone — there is no session, no cookie and no
    // JavaScript from the app itself by the time it renders.
    assert.match(
      offlineShell,
      /location\.pathname\.split\("\/"\)\[1\]/,
      "offline.html no longer reads the tenant slug from the first path " +
        "segment; the manifest's start_url has to keep matching however it does.",
    );
    assert.equal(tenantStartUrl("mg").split("/")[1], "mg");
  });
});

describe("the origin-wide manifest", () => {
  it("launches at the workspace entry screen, not the marketing page", () => {
    // "/" was a dead end: an installed app with no address bar, showing
    // marketing copy whose only sign-in link named a demo tenant that exists
    // in a seeded local database and nowhere else.
    assert.equal(rootManifest().start_url, WORKSPACE_ENTRY_PATHS.uk);
  });

  it("stays outside the worker's scope, which is why the tenant manifest exists", () => {
    // Not a defect to fix here — no origin-wide path can carry a tenant slug,
    // and the offline shell needs one. Pinned so that the day someone widens
    // FIELD_ZONE_PATH, the reason this manifest is the non-offline one gets
    // re-read rather than assumed.
    assert.equal(readFieldZonePattern().test(rootManifest().start_url), false);
  });
});
