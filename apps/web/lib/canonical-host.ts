import { SITE_URL } from "./site";

// The production deployment answers on its Vercel alias as well as on the
// domain the product actually owns, and links into it are not always built
// here: invite emails are composed by the API from `APP_BASE_URL`, so one that
// lags behind a domain move lands in someone's inbox naming `*.vercel.app`.
// Forwarding those requests to the canonical origin keeps the hostname in the
// address bar — and the session cookie behind it — on the real domain no
// matter which link the reader followed, including links already sent.
const CANONICAL_ORIGIN = new URL(SITE_URL).origin;

// Only hostnames that are certainly this same production deployment. Preview
// deployments answer on their own `vizitum-web-<branch-or-hash>-*.vercel.app`
// names and must keep serving themselves, and `localhost`/`127.0.0.1` is how
// the app is developed and e2e-tested.
const REDIRECTED_HOSTS = new Set([
  "vizitum-web.vercel.app",
  // The apex already redirects to `www` at the hosting layer; keeping it here
  // means a change to that configuration cannot quietly strand it.
  "vizitum.com",
]);

/**
 * The canonical URL a request should be redirected to, or `null` when the host
 * it arrived on is already the one to serve it.
 */
export function canonicalRedirectUrl(
  host: string | null | undefined,
  pathWithQuery: string,
): string | null {
  if (!host) {
    return null;
  }

  // Host headers may carry a port, and hostnames are case-insensitive.
  const hostname = host.split(":")[0].toLowerCase();

  if (!REDIRECTED_HOSTS.has(hostname)) {
    return null;
  }

  return `${CANONICAL_ORIGIN}${pathWithQuery}`;
}
