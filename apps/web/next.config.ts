import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Headers that are the same for every request, so they belong here rather
// than in middleware: `headers()` covers static assets too, which middleware
// deliberately skips. The one per-request header — Content-Security-Policy,
// which carries a fresh nonce — lives in middleware.ts.
const STATIC_SECURITY_HEADERS = [
  {
    // A year, with subdomains, so a downgrade to http is refused by the
    // browser rather than merely redirected. Ignored over plain http, so it
    // is safe to send in development too.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    // Stops a browser from second-guessing Content-Type — the difference
    // between a stored file being downloaded and being executed as script.
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    // Full URL to same-origin, origin only to third parties: tenant slugs and
    // record ids sit in our paths and should not leak in a Referer header.
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    // Belt and braces with the CSP's `frame-ancestors 'none'`, for anything
    // that still honours only this header. Login pages were framable, which
    // is the clickjacking case this closes.
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Nothing is gained by advertising the framework and version to a scanner.
  poweredByHeader: false,
  // Dev is browsed via both hostnames; without this Next blocks dev assets
  // (and silently breaks hydration) on the one it doesn't consider its own.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
    ]);
  },
};

export default withNextIntl(nextConfig);
