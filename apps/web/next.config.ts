import path from "node:path";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev is browsed via both hostnames; without this Next blocks dev assets
  // (and silently breaks hydration) on the one it doesn't consider its own.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
};

export default withNextIntl(nextConfig);
