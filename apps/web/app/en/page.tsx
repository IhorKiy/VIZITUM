import type { Metadata } from "next";

import { Landing } from "../../components/landing";
import { buildLandingMetadata } from "../../lib/landing-metadata";
import enMessages from "../../messages/en.json";

// English variant of the root landing (see app/page.tsx). "en" is excluded
// from tenant slug extraction in lib/tenant-locale.ts, so this static route
// never triggers a tenant locale lookup.
const t = enMessages.landing;

export const metadata: Metadata = buildLandingMetadata("en", t);

export default function EnglishHomePage() {
  return <Landing lang="en" messages={t} switchHref="/" />;
}
