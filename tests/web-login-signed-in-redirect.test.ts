import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSignedInRedirect,
  type SignedInSession,
} from "../apps/web/lib/login-redirect";

// The tenant login screen used to render its form unconditionally: every
// redirect in the flow lived inside the login server action, which only runs
// on submit. Found on a real iPhone during the offline pass
// (docs/runbooks/field-offline-iphone-test.md) — a Home Screen install
// restores its last URL on launch and has no address bar, so after an offline
// episode the restored login screen made the app read as signed out while
// `__Host-vizitum_session` was present, unexpired, and good enough to fetch
// the field home. The only visible move was to retype the password, which also
// minted a second session row for nothing.
//
// What this pins is mostly the negative half: which sessions must *not* move
// the reader, since acting on the wrong one is worse than the bug being fixed.

const session = (overrides: Partial<SignedInSession> = {}): SignedInSession => ({
  tenantSlug: "acme",
  permissions: ["visits.read_own"],
  productsEnabled: true,
  pilotActive: true,
  user: { lastSelectedZone: null },
  ...overrides,
});

describe("resolveSignedInRedirect", () => {
  it("sends a session for this workspace where signing in would have", () => {
    assert.equal(
      resolveSignedInRedirect("acme", session()),
      "/acme/field",
      "a rep whose only zone is the field one belongs on the field home",
    );
  });

  it("asks which zone when the session has more than one and picked none", () => {
    assert.equal(
      resolveSignedInRedirect(
        "acme",
        session({ permissions: ["visits.read_own", "users.read"] }),
      ),
      "/acme/choose-zone",
    );
  });

  it("honours the zone the session last chose", () => {
    assert.equal(
      resolveSignedInRedirect(
        "acme",
        session({
          permissions: ["visits.read_own", "users.read"],
          user: { lastSelectedZone: "admin" },
        }),
      ),
      "/acme/admin",
    );
  });

  // The loop this has to avoid, and why it doesn't: /no-access re-resolves the
  // landing itself and renders when it still comes out "no access". It only
  // redirects back to /login when the session is *gone* — the one case below
  // that returns null and draws the form. So the pair terminates in both
  // directions rather than bouncing.
  it("sends a session with no access here to the screen that says so", () => {
    assert.equal(
      resolveSignedInRedirect("acme", session({ permissions: [] })),
      "/acme/no-access",
    );
  });

  it("leaves an anonymous visitor on the form", () => {
    // The whole anti-enumeration stance of this screen (lib/login-error.ts)
    // depends on this: with no session there is nothing to resolve, so a
    // visitor who is not signed in sees exactly what they saw before, and the
    // redirect can't be used to ask whether a workspace or an account exists.
    assert.equal(resolveSignedInRedirect("acme", null), null);
  });

  it("leaves a session for another workspace on the form", () => {
    // A real, valid session — for somewhere else. The session cookie carries
    // the tenant and the URL does not, so acting on it would show acme's data
    // under other-co's address and branding, and would strand the reader:
    // this form is exactly the screen they need to sign in here.
    assert.equal(resolveSignedInRedirect("other-co", session()), null);
  });

  it("leaves a session an older API couldn't place on the form", () => {
    // During a deploy this frontend talks to the previous API for a minute or
    // two, and that one doesn't send `tenantSlug` at all. Absent has to mean
    // "don't act", not "matches" — otherwise the skew window is exactly when
    // a cross-workspace redirect becomes possible.
    assert.equal(
      resolveSignedInRedirect("acme", session({ tenantSlug: undefined })),
      null,
    );
    // Null is the API saying the session outlived its tenant row.
    assert.equal(
      resolveSignedInRedirect("acme", session({ tenantSlug: null })),
      null,
    );
  });

  it("resolves a shouted slug, and redirects to the canonical one", () => {
    // "/MG/login" reaches the workspace (normalizeTenantSlug mirrors the API's
    // own normalizeSlug), but the redirect must not carry the shouting
    // forward into every URL the reader gets afterwards.
    assert.equal(
      resolveSignedInRedirect("ACME", session()),
      "/acme/field",
    );
  });

  it("acts on nothing when the slug isn't one a workspace can have", () => {
    // The tenant layout 404s these before a page renders, so this is a second
    // line rather than the first — but it is also what keeps the returned
    // path same-origin: "\evil.com" would otherwise become "/\evil.com/field",
    // which browsers normalize into a protocol-relative cross-origin URL.
    for (const slug of ["\\evil.com", "acme.html", "-acme", "", "  "]) {
      assert.equal(
        resolveSignedInRedirect(slug, session({ tenantSlug: slug })),
        null,
        `${JSON.stringify(slug)} should not resolve to a redirect`,
      );
    }
  });
});
