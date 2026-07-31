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
// next.config.ts the way the fixed security headers are. The matcher below
// already skips `_next` and anything with a file extension, which keeps the
// nonce policy off public/offline.html — a hand-written page whose inline
// <script> could never carry one.
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

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
