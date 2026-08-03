import type { Metadata } from "next";

// Shared by both root layouts (app/(public) and app/(workspace)). Splitting
// the tree into two root layouts is what keeps the marketing pages static —
// see app/(public)/layout.tsx — but the icons and the default title are
// origin-wide and must not diverge between them, so they live here rather
// than being copied into each.
export const rootMetadata: Metadata = {
  title: "Vizitum",
  description: "Team pilot field operations workspace",
  icons: {
    // SVG first (crisp at any size), PNG for browsers that skip SVG
    // favicons; apple-touch-icon is what iOS actually reads for the
    // home-screen tile - it ignores the manifest's icons entirely.
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
};
