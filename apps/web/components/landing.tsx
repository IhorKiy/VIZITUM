import type enMessages from "../messages/en.json";

export type LandingMessages = (typeof enMessages)["landing"];

export type LandingLocale = "uk" | "en";

// Shared markup for the public marketing landing, rendered by `/` (uk) and
// `/en` (en). The caller pins the dictionary and passes the messages down —
// see app/page.tsx for why the landing bypasses request-scoped locale
// resolution.
export function Landing({
  lang,
  messages: t,
  switchHref,
}: {
  lang: LandingLocale;
  messages: LandingMessages;
  switchHref: string;
}) {
  return (
    <main className="login-surface" lang={lang}>
      <section aria-labelledby="landing-title" className="landing-panel">
        <div className="landing-topbar">
          <div className="brand-block">
            <div className="brand-mark">V</div>
            <p className="brand-name">Vizitum</p>
          </div>
          {/* The switch label is written in the target language on purpose —
              a reader who needs the other language must be able to read it. */}
          <a
            className="landing-lang"
            href={switchHref}
            hrefLang={lang === "uk" ? "en" : "uk"}
          >
            {t.switchLabel}
          </a>
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
