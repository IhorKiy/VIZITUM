import type { Metadata } from "next";

import type { LandingLocale, LandingMessages } from "../components/landing";
import { SITE_URL } from "./site";

const LANDING_URLS: Record<LandingLocale, string> = {
  uk: SITE_URL,
  en: `${SITE_URL}/en`,
};

// hreflang alternates shared by both landing variants; x-default points at
// the Ukrainian root — the primary market's version.
const LANDING_LANGUAGES = {
  uk: LANDING_URLS.uk,
  en: LANDING_URLS.en,
  "x-default": LANDING_URLS.uk,
};

export function buildLandingMetadata(
  locale: LandingLocale,
  t: LandingMessages,
): Metadata {
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: LANDING_URLS[locale],
      languages: LANDING_LANGUAGES,
    },
    openGraph: {
      title: t.metaTitle,
      description: t.metaDescription,
      url: LANDING_URLS[locale],
      siteName: "Vizitum",
      locale: locale === "uk" ? "uk_UA" : "en_US",
      type: "website",
    },
  };
}
