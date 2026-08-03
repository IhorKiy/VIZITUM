import type { Metadata } from "next";

import { Landing } from "../../components/landing";
import { buildLandingMetadata } from "../../lib/landing-metadata";
import ukMessages from "../../messages/uk.json";

// The root landing is a public marketing page for the Ukrainian market. It
// has no tenant to resolve a locale from (the request-scoped locale falls
// back to English there), so it pins the Ukrainian dictionary directly —
// the strings still live in messages/ next to everything else. The English
// variant lives at /en (app/en/page.tsx).
const t = ukMessages.landing;

export const metadata: Metadata = buildLandingMetadata("uk", t);

export default function HomePage() {
  return (
    <Landing lang="uk" messages={t} signInHref="/sign-in" switchHref="/en" />
  );
}
