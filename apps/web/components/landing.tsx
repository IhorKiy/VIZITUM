import type enMessages from "../messages/en.json";
import { CONTACT_EMAIL } from "../lib/site";

export type LandingMessages = (typeof enMessages)["landing"];

export type LandingLocale = "uk" | "en";

// Shared markup for the public marketing landing, rendered by `/` (uk) and
// `/en` (en). The caller pins the dictionary and passes the messages down —
// see app/page.tsx for why the landing bypasses request-scoped locale
// resolution.
//
// `signInHref` is the workspace entry screen in the same language, never a
// tenant. Tenancy here is path-shaped, so the one thing this page cannot know
// is which workspace its reader belongs to: it once named a demo tenant that
// exists in a seeded local database and nowhere else, which on the real
// deployment resolved to a login screen that answered every password with
// "wrong email or password".
export function Landing({
  lang,
  messages: t,
  signInHref,
  switchHref,
}: {
  lang: LandingLocale;
  messages: LandingMessages;
  signInHref: string;
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

        {/* The one thing a reader who is *not* a customer can do here. It sits
            above the sign-in row on purpose: the badge says the platform is
            still in development, so most of this page's traffic has no
            workspace to sign in to, and the only other control on the card
            answers every one of those readers with a login screen.

            The link's text is the address itself rather than a "Write to us"
            label: a visible address can be copied into whatever mail client
            the reader actually uses, and reads as a real inbox in a way a
            button hiding a mailto: does not. The prefilled subject is a
            convenience for both ends — one less blank field for the sender,
            a filterable marker for the inbox. */}
        <div className="landing-contact">
          <p className="landing-contact-title">{t.contactTitle}</p>
          <p className="landing-contact-copy">{t.contactCopy}</p>
          <a
            className="landing-contact-link"
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t.contactSubject)}`}
          >
            {CONTACT_EMAIL}
          </a>
        </div>

        <div className="landing-signin">
          <p className="landing-hint">{t.hint}</p>
          <a className="landing-cta" href={signInHref}>
            {t.signIn}
          </a>
        </div>
      </section>
    </main>
  );
}
