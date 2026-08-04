import type { MetadataRoute } from "next";

// The parts of a web app manifest that are the same whichever manifest is
// being served — shared by the origin-wide one (app/manifest.ts) and the
// per-tenant one (app/[tenantSlug]/manifest.webmanifest/route.ts) so a new
// icon or a theme change lands in both. Everything tenant-shaped (name,
// start_url, scope, id) is deliberately not here: that is the entire
// difference between the two.
//
// English on purpose, same standing exception as platform/* — a manifest is
// fetched with no tenant context to resolve a locale from, and the per-tenant
// one carries the workspace's own name rather than a translated string.
export const MANIFEST_DESCRIPTION =
  "Field visits, routes and reports for field teams";
export const MANIFEST_BACKGROUND_COLOR = "#f6f4ef";
export const MANIFEST_THEME_COLOR = "#176b5f";

export const MANIFEST_ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  // Full-bleed square artwork with the glyph inside the safe zone, so the
  // same files serve as maskable sources for launcher shapes.
  {
    src: "/icon-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "maskable",
  },
  {
    src: "/icon-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

// Where an installed tenant app launches. Two constraints meet here and only
// one path satisfies both:
//
//   1. It has to reach a tenant. A standalone install has no address bar, so
//      a launch destination that lands on the wrong workspace (or on the
//      marketing page) is a dead end with no way to navigate out of it.
//   2. It has to sit inside the service worker's navigation-fallback scope
//      (FIELD_ZONE_PATH in public/sw.js, which matches /{slug}/field only).
//      Outside that scope a failed full-page navigation gets the browser's
//      own error page instead of offline.html, and the offline shell reads
//      the tenant slug straight off the first path segment
//      (public/offline.html), so the slug has to be in the URL rather than in
//      a cookie or a redirect that a signal-less load never gets to run.
//
// Constraint 2 buys less than it was originally written to buy, and the
// difference is worth knowing before anyone re-tunes this. It covers full-page
// loads made from a context the worker already controls — a warm installed app
// that loses signal and reloads. It does *not* rescue a cold launch with no
// network: WebKit fails that navigation before the worker sees it, whatever
// the start_url is (measured on iOS 18.7.9 — see public/sw.js's "What this
// does not cover"). Keeping the start_url in scope is still right, and
// constraint 1 is untouched by any of this; just don't read this line as a
// promise that the installed app opens offline from cold.
//
// tests/web-app-manifest.test.ts pins both against sw.js itself.
export function tenantStartUrl(tenantSlug: string): string {
  return `/${tenantSlug}/field`;
}
