import { NextResponse, type NextRequest } from "next/server";

// next-intl resolves the locale per request in i18n/request.ts, which runs
// outside the routing tree and cannot see the URL. The proxy forwards the
// pathname as a request header so the tenant slug can be extracted there.
export default function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
