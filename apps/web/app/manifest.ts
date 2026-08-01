import type { MetadataRoute } from "next";

import {
  MANIFEST_BACKGROUND_COLOR,
  MANIFEST_DESCRIPTION,
  MANIFEST_ICONS,
  MANIFEST_THEME_COLOR,
} from "../lib/manifest";
import { WORKSPACE_ENTRY_PATHS } from "../lib/workspace-address";

// The origin-wide manifest, covering every page that has no tenant to speak
// of: the marketing landing, /sign-in, platform/*. One manifest for the whole
// origin genuinely cannot know a tenant — so this one doesn't try. The
// workspace's own manifest, which can, is served under its path and linked
// from the field zone (app/[tenantSlug]/manifest.webmanifest/route.ts); that
// is the install a field representative should end up with, and the only one
// whose start_url the service worker can serve offline.
//
// start_url is the workspace entry screen rather than "/": an installed app
// that launches on marketing copy has no address bar to escape it with, while
// /sign-in offers back the workspace this browser last signed in to and asks
// for one otherwise. It reaches a tenant, which "/" never did. The Ukrainian
// variant, for the same reason landing-metadata.ts points x-default at the
// Ukrainian root — it is the primary market's version, and the entry screen
// links to its English twin.
//
// What this start_url cannot be is offline-capable: sw.js only serves its
// cached shell for /{slug}/field, and no origin-wide path can carry a slug.
// That is the whole reason the tenant manifest exists, and why the field zone
// links that one instead.
//
// English on purpose, same standing exception as platform/* - a manifest is
// fetched with no tenant context to resolve a locale from.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vizitum",
    short_name: "Vizitum",
    description: MANIFEST_DESCRIPTION,
    start_url: WORKSPACE_ENTRY_PATHS.uk,
    display: "standalone",
    background_color: MANIFEST_BACKGROUND_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
    icons: MANIFEST_ICONS,
  };
}
