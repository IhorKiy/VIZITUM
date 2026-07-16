import type { Metadata } from "next";

import ukMessages from "../messages/uk.json";
import { SITE_URL } from "../lib/site";

// The root landing is a public marketing page for the Ukrainian market. It
// has no tenant to resolve a locale from (the request-scoped locale falls
// back to English there), so it pins the Ukrainian dictionary directly —
// the strings still live in messages/ next to everything else.
const t = ukMessages.landing;

export const metadata: Metadata = {
  title: t.metaTitle,
  description: t.metaDescription,
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: t.metaTitle,
    description: t.metaDescription,
    url: SITE_URL,
    siteName: "Vizitum",
    locale: "uk_UA",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <main className="login-surface" lang="uk">
      <section aria-labelledby="landing-title" className="landing-panel">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <p className="brand-name">Vizitum</p>
        </div>

        <div>
          <p className="landing-badge">{t.badge}</p>
          <h1 id="landing-title">{t.title}</h1>
          <p className="login-copy">{t.copy}</p>
        </div>

        <div className="landing-signin">
          <p className="landing-hint">{t.hint}</p>
          <a className="landing-cta" href="/demo-team/login">
            {t.signIn}
          </a>
        </div>
      </section>
    </main>
  );
}
