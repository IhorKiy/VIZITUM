import type { MetadataRoute } from "next";

// Home-screen installability for the field zone (the follow-up the offline
// series left behind once real icons existed - docs/plans/
// offline-field-drafts-plan-prompt.md). One manifest for the whole origin:
// it cannot know a tenant, so start_url is the root redirect/marketing page
// and the name is the platform brand, not a tenant's. English on purpose,
// same standing exception as platform/* - a manifest is fetched with no
// tenant context to resolve a locale from.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vizitum",
    short_name: "Vizitum",
    description: "Field visits, routes and reports for field teams",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#176b5f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Full-bleed square artwork with the glyph inside the safe zone, so
      // the same files serve as maskable sources for launcher shapes.
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
    ],
  };
}
