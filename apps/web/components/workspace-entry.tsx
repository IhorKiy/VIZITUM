import { createTranslator } from "next-intl";

import type enMessages from "../messages/en.json";
import { INPUT_LIMITS } from "../lib/input-limits";
import type { RememberedWorkspace } from "../lib/remembered-workspace";
import { PendingSubmitButton } from "./pending-submit-button";

export type WorkspaceEntryMessages = (typeof enMessages)["workspaceEntry"];

export type WorkspaceEntryLocale = "uk" | "en";

// "invalid" is an answer that could not name any workspace; "notFound" is one
// that could, but names none that exists. Worth telling apart: they call for
// different corrections, and collapsing them would send someone who pasted a
// perfectly good link hunting for a typo in it.
export type WorkspaceEntryError = "invalid" | "notFound";

export function toWorkspaceEntryError(
  value: string | undefined,
): WorkspaceEntryError | null {
  return value === "invalid" || value === "notFound" ? value : null;
}

/**
 * "Which workspace?" — the screen that has to exist because tenancy in this
 * product is path-shaped, so a sign-in link cannot be a constant.
 *
 * Shared markup for `/sign-in` (uk) and `/en/sign-in` (en), which pin their
 * own dictionaries the way the marketing landing does — neither has a tenant
 * to resolve a locale from, and a reader arriving from the landing must not
 * change language on the way in. See app/page.tsx for the pattern. Unlike the
 * landing this screen has a string to interpolate a name into, so the pinned
 * dictionary goes through createTranslator rather than being indexed
 * directly: same ICU handling as every other screen, just with the locale
 * supplied instead of resolved.
 *
 * The remembered workspace is offered rather than redirected to. A silent
 * forward would be faster for the common case and a dead end for the one that
 * matters: a rep whose phone remembers the wrong workspace, in a standalone
 * install with no address bar, would have no way to reach the right one —
 * which is the failure this screen exists to end, not to relocate.
 */
export function WorkspaceEntry({
  action,
  error,
  homeHref,
  lang,
  messages,
  remembered,
}: {
  action: (formData: FormData) => void | Promise<void>;
  error: WorkspaceEntryError | null;
  homeHref: string;
  lang: WorkspaceEntryLocale;
  messages: WorkspaceEntryMessages;
  remembered: RememberedWorkspace | null;
}) {
  const t = createTranslator({
    locale: lang,
    messages: { workspaceEntry: messages },
    namespace: "workspaceEntry",
  });

  return (
    <main className="login-surface" lang={lang}>
      <section aria-labelledby="workspace-entry-title" className="login-panel">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <p className="brand-name">Vizitum</p>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="workspace-entry-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error === "notFound" ? t("errorNotFound") : t("errorInvalid")}
          </div>
        ) : null}

        {remembered ? (
          <div className="workspace-recent">
            <p className="form-hint">{t("rememberedHint")}</p>
            <a
              className="primary-button"
              href={`/${remembered.tenantSlug}/login`}
            >
              {t("rememberedAction", { workspace: remembered.name })}
            </a>
          </div>
        ) : null}

        <form action={action} className="form-stack">
          <label>
            {remembered ? t("otherWorkspaceLabel") : t("workspaceLabel")}
            <input
              // A slug is lowercase ASCII with no dictionary word in it, and
              // this is the one field a phone keyboard would otherwise
              // capitalize and autocorrect into something that cannot resolve.
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              maxLength={INPUT_LIMITS.slug}
              name="workspace"
              placeholder={t("workspacePlaceholder")}
              required
              spellCheck={false}
              type="text"
            />
          </label>
          <p className="form-hint">{t("workspaceHint")}</p>
          {/* Naming this wait rather than letting it fall back to
              "Saving...": nothing is being saved, and what comes next is a
              whole other screen. */}
          <PendingSubmitButton
            className={remembered ? "secondary-button" : "primary-button"}
            pendingLabel={t("pending")}
          >
            {t("submit")}
          </PendingSubmitButton>
        </form>

        <a className="auth-link" href={homeHref}>
          {t("backHome")}
        </a>
      </section>
    </main>
  );
}
