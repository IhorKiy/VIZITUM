import type { AuthSession } from "./api-client";
import { resolveZoneLanding, zoneLandingPath } from "./navigation";
import { normalizeTenantSlug } from "./tenant-locale";

// Everything the landing decision reads, and nothing else — so a caller can
// only reach this with a session it actually holds, and a test can build one
// without inventing a whole user. Tied to AuthSession rather than restated,
// so a field that changes shape breaks here rather than drifting.
export type SignedInSession = Pick<
  AuthSession,
  "permissions" | "productsEnabled" | "pilotActive" | "tenantSlug"
> & { user: Pick<AuthSession["user"], "lastSelectedZone"> };

/**
 * Where a login screen should send a visitor who is already signed in, or
 * null to render the form as before.
 *
 * A Home Screen install restores its last URL on launch and has no address
 * bar. After an offline episode on the real iPhone pass
 * (docs/runbooks/field-offline-iphone-test.md) that restored URL was the login
 * screen — so the app looked signed out while the session was in fact valid,
 * and the only move a rep could see was to type the password again, minting a
 * second session for nothing. Every redirect in this flow used to live inside
 * the login action, which only runs on submit; opening the page checked
 * nothing.
 *
 * Three properties this has to keep:
 *
 * - **It reveals nothing.** The redirect is driven by a session the API
 *   answered `GET /auth/me` for, never by the slug in the URL or by anything
 *   a visitor can supply. An anonymous request has no session to resolve, so
 *   it still gets exactly the form it got before — which is what keeps this
 *   compatible with the deliberate anti-enumeration stance of the rest of the
 *   screen (lib/login-error.ts).
 *
 * - **It cannot loop.** The destinations are the three the login action
 *   already picks, and each of them terminates for a session that arrives
 *   there: the zone home renders, `/choose-zone` renders once a zone is
 *   genuinely ambiguous, and `/no-access` renders rather than bouncing back
 *   here — it only redirects to `/login` when the session is *gone*, which is
 *   the one case this returns null for.
 *
 * - **It only acts on a session for this workspace.** The session cookie
 *   carries the tenant and the URL does not, so a session for `acme` reading
 *   `/other-co/login` is a real, valid session — for somewhere else. Sending
 *   it into `/other-co/field` would show acme's data under another
 *   workspace's address and branding, and would strand the reader: the login
 *   form is exactly the screen they need to sign in here. So a mismatch
 *   renders the form, as does a session from an API too old to say which
 *   workspace it means (`tenantSlug` absent — during a deploy this frontend
 *   talks to the previous API for a minute or two).
 */
export function resolveSignedInRedirect(
  tenantSlug: string,
  session: SignedInSession | null,
): string | null {
  const slug = normalizeTenantSlug(tenantSlug);

  // Compared against the API's stored slug as-is: it is already normalized
  // there (TenancyService.normalizeSlug on the way in), so anything that
  // fails to match is a session this screen must not act on.
  if (!slug || !session || session.tenantSlug !== slug) {
    return null;
  }

  // The normalized slug, not the raw route param, so the redirect lands on
  // the canonical address and can only ever be same-origin.
  return zoneLandingPath(
    slug,
    resolveZoneLanding(
      session.permissions,
      session.productsEnabled,
      session.user.lastSelectedZone,
      session.pilotActive,
    ),
  );
}
