import { cookies } from "next/headers";

import { resolveTenantBranding } from "./tenant-branding";
import { isTenantSlug } from "./tenant-locale";

export type RememberedWorkspace = {
  tenantSlug: string;
  name: string;
};

// The workspace this browser last signed in to, so the entry screen can offer
// it back instead of asking a returning reader to remember a slug. Written
// wherever the API has actually issued a session — the login action and the
// invite-accept action, the latter being the only entry a newly invited rep
// makes before installing to the Home Screen — and never from a slug someone
// merely typed, which is evidence of nothing. Deliberately *not* cleared on
// sign-out, since "come back tomorrow and sign in again" is exactly the case
// it exists for.
//
// httpOnly: nothing client-side reads it, and the one thing it reveals — which
// workspace this device belongs to — has no reason to be scriptable.
const WORKSPACE_COOKIE = "vizitum_workspace";
// Chromium and Safari both clamp cookie lifetimes to 400 days, so asking for
// more just gets silently trimmed.
const WORKSPACE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export async function rememberWorkspace(tenantSlug: string): Promise<void> {
  if (!isTenantSlug(tenantSlug)) {
    return;
  }

  const cookieStore = await cookies();

  cookieStore.set(WORKSPACE_COOKIE, tenantSlug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WORKSPACE_MAX_AGE_SECONDS,
  });
}

// Re-validated on read rather than trusted: the cookie outlives deploys, and
// the value goes straight into a link.
async function readRememberedWorkspace(): Promise<string | null> {
  const value = (await cookies()).get(WORKSPACE_COOKIE)?.value;

  return value && isTenantSlug(value) ? value : null;
}

/**
 * The remembered workspace with a name worth showing, or null.
 *
 * Null on a workspace that no longer exists, not just on an empty cookie: the
 * cookie lives for over a year, and offering a workspace that has since been
 * deleted would put the reader back on a login screen that cannot work —
 * the exact failure the entry screen exists to prevent. A workspace whose
 * lookup merely failed ("unknown") is still offered, since the alternative is
 * an API blip silently forgetting where everyone works.
 */
export async function resolveRememberedWorkspace(): Promise<RememberedWorkspace | null> {
  const tenantSlug = await readRememberedWorkspace();

  if (!tenantSlug) {
    return null;
  }

  const branding = await resolveTenantBranding(tenantSlug);

  return branding.existence === "missing"
    ? null
    : { tenantSlug, name: branding.name };
}
