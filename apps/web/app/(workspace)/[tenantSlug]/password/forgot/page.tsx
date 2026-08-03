import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { BrandMark } from "../../../../../components/brand-mark";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import { TurnstileWidget } from "../../../../../components/turnstile-widget";
import { buildApiUrl } from "../../../../../lib/api-client";
import { getFormString } from "../../../../../lib/form";
import { INPUT_LIMITS } from "../../../../../lib/input-limits";
import { resolveTenantBranding } from "../../../../../lib/tenant-branding";

type ForgotPasswordPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
};

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: ForgotPasswordPageProps) {
  const { tenantSlug } = await params;
  const { sent, error } = await searchParams;
  const [t, tSection, locale, branding] = await Promise.all([
    getTranslations("passwordReset"),
    getTranslations("passwordReset.forgot"),
    getLocale(),
    resolveTenantBranding(tenantSlug),
  ]);
  // Read per request rather than NEXT_PUBLIC_*, same as the login screen, so
  // staging and production can differ without a rebuild.
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY?.trim() || null;

  async function requestResetAction(formData: FormData) {
    "use server";

    let response: Response;

    try {
      response = await fetch(buildApiUrl("/auth/password/forgot"), {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: getFormString(formData, "email"),
          tenantSlug,
          captchaToken: getFormString(formData, "cf-turnstile-response"),
        }),
      });
    } catch {
      redirect(`/${tenantSlug}/password/forgot?error=network`);
    }

    if (!response.ok) {
      let code: string | undefined;

      try {
        code = ((await response.json()) as { code?: string }).code;
      } catch {
        // Non-JSON error body; fall through to the generic message.
      }

      // The endpoint answers 200 for an unknown address by design, so the only
      // failures that reach here are the captcha and genuine outages — never
      // "no such account", which must stay indistinguishable from success.
      redirect(
        `/${tenantSlug}/password/forgot?error=${
          code === "CAPTCHA_INVALID" ? "captcha" : "network"
        }`,
      );
    }

    redirect(`/${tenantSlug}/password/forgot?sent=1`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="forgot-password-title">
        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="forgot-password-title">
            {sent ? tSection("sentTitle") : tSection("title")}
          </h1>
          <p className="login-copy">
            {sent ? tSection("sentCopy") : tSection("copy")}
          </p>
        </div>

        {/* The confirmation deliberately never names the address back, and the
            form is gone once it shows: repeating "we sent it to x@y" would turn
            a typo into a silent dead end, and leaving the form up invites the
            re-submits the per-account throttle then drops. */}
        {sent ? (
          <>
            <p className="form-hint">{tSection("sentHint")}</p>
            <Link className="secondary-button" href={`/${tenantSlug}/login`}>
              {t("backToSignIn")}
            </Link>
          </>
        ) : (
          <>
            {error ? (
              <div className="form-error" role="alert">
                {error === "captcha"
                  ? tSection("errorCaptcha")
                  : tSection("errorNetwork")}
              </div>
            ) : null}

            <form action={requestResetAction} className="form-stack">
              <label>
                {tSection("email")}
                <input
                  autoComplete="email"
                  maxLength={INPUT_LIMITS.email}
                  name="email"
                  required
                  type="email"
                />
              </label>
              {turnstileSiteKey ? (
                <TurnstileWidget language={locale} siteKey={turnstileSiteKey} />
              ) : null}
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={tSection("submitting")}
              >
                {tSection("submit")}
              </PendingSubmitButton>
            </form>

            <Link className="auth-link" href={`/${tenantSlug}/login`}>
              {t("backToSignIn")}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
