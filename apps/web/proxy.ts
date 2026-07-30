import { NextResponse, type NextRequest } from "next/server";

import { canonicalRedirectUrl } from "./lib/canonical-host";

// next-intl resolves the locale per request in i18n/request.ts, which runs
// outside the routing tree and cannot see the URL. The proxy forwards the
// pathname as a request header so the tenant slug can be extracted there.
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
