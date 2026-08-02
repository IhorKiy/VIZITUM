import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { BrandMark } from "../../../components/brand-mark";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { TurnstileWidget } from "../../../components/turnstile-widget";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { buildApiUrl, getCurrentSession } from "../../../lib/api-client";
import { rememberWorkspace } from "../../../lib/remembered-workspace";
import { resolveTenantBranding } from "../../../lib/tenant-branding";
import { resolveZoneLanding, zoneHomePath } from "../../../lib/navigation";
import { getFormString } from "../../../lib/form";
import { INPUT_LIMITS } from "../../../lib/input-limits";
import {
  loginErrorMessageKey,
  loginErrorReason,
} from "../../../lib/login-error";
import { workspaceEntryPath } from "../../../lib/workspace-address";

type LoginPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function LoginPage({
  params,
  searchParams,
}: LoginPageProps) {
  const { tenantSlug } = await params;
  const { error, notice } = await searchParams;
  const [t, tCommon, locale, branding] = await Promise.all([
    getTranslations("auth"),
    getTranslations("common"),
    getLocale(),
    resolveTenantBranding(tenantSlug),
  ]);
  // Read per request (not NEXT_PUBLIC_*), so staging/production can differ
  // without a rebuild; unset means the captcha is off for this deployment.
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

  async function loginAction(formData: FormData) {
    "use server";

    const email = getFormString(formData, "email");
    const password = getFormString(formData, "password");
    let response: Response;

    try {
      response = await fetch(buildApiUrl("/auth/login"), {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          tenantSlug,
          // Hidden input injected by the Turnstile widget; empty when the
          // captcha is disabled for this deployment.
          captchaToken: getFormString(formData, "cf-turnstile-response"),
        }),
      });
    } catch {
      redirect(`/${tenantSlug}/login?error=network`);
    }

    if (!response.ok) {
      let code: string | undefined;

      try {
        code = ((await response.json()) as { code?: string }).code;
      } catch {
        // Non-JSON error body; fall through to the generic message.
      }

      redirect(`/${tenantSlug}/login?error=${loginErrorReason(code)}`);
    }

    await forwardSetCookies(response.headers);
    // Only after a sign-in the API accepted: a slug someone merely typed
    // proves nothing, and this is what the workspace entry screen offers back
    // on the next visit (lib/remembered-workspace.ts).
    await rememberWorkspace(tenantSlug);

    // Fresh cookies set above are visible to this same-action read: Server
    // Actions expose cookies().set() to subsequent cookies() reads within
    // the same execution, so this sees the just-created session with no
    // extra user-visible round trip. Reused (rather than growing
    // POST /auth/login's response) because /auth/me already assembles
    // productsEnabled, which login() doesn't currently look up.
    const sessionResult = await getCurrentSession();
    const landing = resolveZoneLanding(
      sessionResult.ok ? sessionResult.data.permissions : undefined,
      sessionResult.ok ? sessionResult.data.productsEnabled : true,
      sessionResult.ok ? sessionResult.data.user.lastSelectedZone : null,
      sessionResult.ok ? sessionResult.data.pilotActive : true,
    );

    if (landing.kind === "zone") {
      redirect(`/${tenantSlug}${zoneHomePath(landing.zone)}`);
    }

    if (landing.kind === "choose") {
      redirect(`/${tenantSlug}/choose-zone`);
    }

    redirect(`/${tenantSlug}/no-access`);
  }

  // A workspace that does not exist cannot answer a password with anything
  // but "invalid email or password": tenant resolution fails on the API long
  // before any credential is looked at, and this page maps that 404 to the
  // same error as a wrong password. Rendering the form anyway is what turned
  // a stale link into an hour of doubting known-good credentials during the
  // iOS pass (docs/runbooks/field-offline-iphone-test.md) — and in a
  // standalone install there is not even an address bar to notice the wrong
  // slug in. Only a confirmed 404 gets this screen; an unreachable API still
  // renders the form, since "your workspace does not exist" is the wrong way
  // to report a backend outage.
  if (branding.existence === "missing") {
    return (
      <main className="login-surface">
        <section className="login-panel" aria-labelledby="login-title">
          <div className="brand-block">
            <div className="brand-mark">V</div>
            <p className="brand-name">Vizitum</p>
          </div>

          <div>
            <p className="eyebrow">{t("unknownWorkspaceEyebrow")}</p>
            <h1 id="login-title">{t("unknownWorkspaceTitle")}</h1>
            <p className="login-copy">{t("unknownWorkspaceCopy")}</p>
          </div>

          <a className="primary-button" href={workspaceEntryPath(locale)}>
            {t("unknownWorkspaceAction")}
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="login-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
        </div>

        {/* The reset flow deliberately issues no session, so this line is the
            only thing telling someone who just chose a new password that it
            took — otherwise the reset lands them back on a bare login screen
            indistinguishable from a failed one. */}
        {notice === "passwordReset" && !error ? (
          <div className="form-success" role="status">
            {t("noticePasswordReset")}
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {t(loginErrorMessageKey(error))}
          </div>
        ) : null}

        <form action={loginAction} className="form-stack">
          <label>
            {t("email")}
            <input
              autoComplete="email"
              maxLength={INPUT_LIMITS.email}
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            {t("password")}
            <input
              autoComplete="current-password"
              maxLength={INPUT_LIMITS.password}
              name="password"
              required
              type="password"
            />
          </label>
          {turnstileSiteKey ? (
            <TurnstileWidget language={locale} siteKey={turnstileSiteKey} />
          ) : null}
          {/* Signing in is the longest wait in the product: the login call,
              then /auth/me, then the landing zone's own first render. The
              button holds through all of it — on a phone in a shop the
              alternative is a rep tapping a screen that looks unchanged. */}
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={tCommon("signingIn")}
          >
            {tCommon("signIn")}
          </PendingSubmitButton>
        </form>

        <Link className="auth-link" href={`/${tenantSlug}/password/forgot`}>
          {t("forgotPassword")}
        </Link>
      </section>
    </main>
  );
}
