import type { MetadataRoute } from "next";

import {
  MANIFEST_BACKGROUND_COLOR,
  MANIFEST_DESCRIPTION,
  MANIFEST_ICONS,
  MANIFEST_THEME_COLOR,
  tenantStartUrl,
} from "../../../lib/manifest";
import { resolveTenantBranding } from "../../../lib/tenant-branding";

/**
 * The workspace's own web app manifest — the one a Home Screen install
 * actually needs.
 *
 * app/manifest.ts serves the whole origin and, as its own comment says,
 * cannot know a tenant. That is true of a manifest fetched from `/`; it stops
 * being true once the manifest is served *under* the tenant's path and linked
 * from the tenant's pages (see the field layout's generateMetadata). Install
 * happens from a field screen, so by then the slug is right there in the URL
 * and the manifest can name the workspace, launch into it, and scope the
 * installed app to it.
 *
 * `scope` is the whole tenant rather than just its field zone: signing out
 * lands on /{slug}/login, which has to stay inside the installed app rather
 * than kicking the reader out to a browser tab. Anything outside the
 * workspace (the marketing pages, another tenant) opening in the browser
 * instead is the intended behavior, not a side effect — that is the boundary
 * of what this install is.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await params;
  const branding = await resolveTenantBranding(tenantSlug);

  // Only a confirmed 404 from the public branding endpoint gets a 404 here;
  // an API blip resolves to "unknown" and still serves a manifest. Installing
  // an app for a workspace that does not exist is the failure this whole
  // change is about, but refusing to install during a backend hiccup would
  // be a worse one.
  if (branding.existence === "missing") {
    return new Response("Not Found", { status: 404 });
  }

  const manifest: MetadataRoute.Manifest = {
    // The workspace name leads: a rep carrying two workspaces on one phone
    // sees two icons, and "Vizitum" twice tells them nothing. iOS truncates
    // the home-screen caption to roughly a dozen characters, so short_name
    // is the bare workspace name with no brand prefix to spend them on.
    name: `${branding.name} — Vizitum`,
    short_name: branding.name,
    description: MANIFEST_DESCRIPTION,
    // Identity is the workspace, not today's launch destination, so
    // start_url can move later without the browser treating the result as a
    // different app and stranding everyone's existing install.
    id: `/${tenantSlug}/`,
    start_url: tenantStartUrl(tenantSlug),
    scope: `/${tenantSlug}/`,
    display: "standalone",
    background_color: MANIFEST_BACKGROUND_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
    icons: MANIFEST_ICONS,
  };

  return Response.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      // Per tenant and cheap to rebuild; a stale copy would keep a renamed
      // workspace's old name on the home screen.
      "Cache-Control": "no-store",
    },
  });
}
