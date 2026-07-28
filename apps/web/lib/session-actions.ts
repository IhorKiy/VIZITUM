"use server";

import { redirect } from "next/navigation";

import {
  buildApiUrl,
  buildRequestHeaders,
  TENANT_CSRF_COOKIE_NAME,
  TENANT_SESSION_COOKIE_NAME,
} from "./api-client";
import { clearCookies } from "./backend-cookies";
import { getFormString } from "./form";
import { isTenantSlug } from "./tenant-locale";

// Signing out of a tenant workspace. Lives in a "use server" module rather than
// inline in a page because the control sits in the shared field menu, which
// every field screen renders — a server action defined in one page can't be
// reached from a component another page mounts.
export async function logoutAction(formData: FormData): Promise<void> {
  const tenantSlug = getFormString(formData, "tenantSlug");

  try {
    // Only the server-side revocation matters here (logout is CSRF-exempt, so
    // a stale CSRF cookie can't block it). The response's Set-Cookie headers
    // only clear the same two cookies removed below, so they are deliberately
    // not forwarded.
    await fetch(buildApiUrl("/auth/logout"), {
      method: "POST",
      cache: "no-store",
      headers: await buildRequestHeaders("/auth/logout"),
    });
  } catch {
    // Fall through: the cookies still get cleared below.
  }

  // Never rely on the API call alone to end the session: a network error (or
  // backend outage) means nothing was revoked server-side, yet the UI is about
  // to tell the user they're signed out. The browser must not keep a working
  // session cookie past that point.
  await clearCookies([TENANT_SESSION_COOKIE_NAME, TENANT_CSRF_COOKIE_NAME]);

  // isTenantSlug also keeps the redirect same-origin: a crafted slug like
  // "\evil.com" would otherwise become "/\evil.com/login" — a URL browsers
  // normalize to a protocol-relative cross-origin redirect.
  redirect(isTenantSlug(tenantSlug) ? `/${tenantSlug}/login` : "/");
}
