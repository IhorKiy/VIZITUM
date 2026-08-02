import { NextResponse, type NextRequest } from "next/server";

import { canonicalRedirectUrl } from "./lib/canonical-host";
import {
  buildContentSecurityPolicy,
  createCspNonce,
} from "./lib/content-security-policy";

// next-intl resolves the locale per request in i18n/request.ts, which runs
// outside the routing tree and cannot see the URL. The proxy forwards the
// pathname as a request header so the tenant slug can be extracted there.
//
// It is also where Content-Security-Policy is set, for the same reason: the
// policy carries a per-request nonce, so it cannot be a static entry in
// next.config.ts the way the fixed security headers are. Which paths that
// policy reaches is decided by the matcher at the bottom of this file — see
// the note there for why "anything with a dot" was the wrong test.
export default function proxy(request: NextRequest) {
  const canonicalUrl = canonicalRedirectUrl(
    request.headers.get("host"),
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  if (canonicalUrl) {
    // Temporary (307), not permanent: a 308 is cached for the life of the
    // browser profile, which would strand everyone on the alias if the custom
    // domain ever had to be bypassed. Crawlers are steered by the canonical
    // tags in lib/landing-metadata.ts, so nothing here needs the permanent
    // variant. 307 also keeps the method, which a 302 would not: a server
    // action that somehow posts to the alias is replayed as a POST rather than
    // arriving as a GET the route cannot answer. The replay does not go
    // through either — it is cross-origin, so the browser sends `Origin: null`
    // and Next's server action origin check refuses it — but that is a visible
    // failure on a request nobody should be making, not a silent downgrade.
    return NextResponse.redirect(canonicalUrl, 307);
  }

  const nonce = createCspNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // Next reads the nonce back out of this request header and stamps it onto
  // every script tag it renders; without it none of them would match the
  // policy on the response.
  requestHeaders.set("content-security-policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", contentSecurityPolicy);

  return response;
}

// Skips `_next` and the static files in `public/`, matched on a real file
// extension at the end of the path.
//
// The previous pattern excluded any path containing a dot *anywhere*
// (`.*\..*`), which is the shape most Next examples use. That is safe only
// while no route segment can contain a dot — and `[tenantSlug]` can hold
// anything, so `/acme.x/field` rendered the real, session-authenticated app
// (the session cookie decides what is served, not the slug) with no
// Content-Security-Policy and no nonce. An XSS anywhere in the app lost its
// main mitigation to one extra character in the URL.
//
// Anchoring on a known extension list keeps public/offline.html and sw.js out
// — a hand-written page whose inline <script> could never carry a nonce, and
// a worker that is not a document — while a dot inside a path segment no
// longer opts a page out of the policy. `tests/web-csp-matcher.test.ts` pins
// both halves.
export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|mjs|map|txt|xml|json|webmanifest|woff|woff2|ttf|html)$).*)",
  ],
};
