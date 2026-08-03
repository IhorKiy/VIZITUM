import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BrandMark } from "../../../../../components/brand-mark";
import { PasswordFields } from "../../../../../components/password-fields";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import { buildApiUrl } from "../../../../../lib/api-client";
import { getFormString } from "../../../../../lib/form";
import { INPUT_LIMITS } from "../../../../../lib/input-limits";
import { resolveTenantBranding } from "../../../../../lib/tenant-branding";

type ResetPasswordPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: ResetPasswordPageProps) {
  const { tenantSlug } = await params;
  const { token = "", error } = await searchParams;
  const [t, tSection, tCommon, branding] = await Promise.all([
    getTranslations("passwordReset"),
    getTranslations("passwordReset.reset"),
    getTranslations("common"),
    resolveTenantBranding(tenantSlug),
  ]);

  async function resetPasswordAction(formData: FormData) {
    "use server";

    // The token travels in the form body, not in the redirect below: a failed
    // attempt must not put it back in the URL bar, where it would outlive the
    // attempt in history and in any shared screenshot of the error.
    let response: Response;

    try {
      response = await fetch(buildApiUrl("/auth/password/reset"), {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          token: getFormString(formData, "token"),
          tenantSlug,
          password: getFormString(formData, "password"),
        }),
      });
    } catch {
      redirect(`/${tenantSlug}/password/reset?error=network`);
    }

    if (!response.ok) {
      redirect(`/${tenantSlug}/password/reset?error=invalid`);
    }

    // No session is issued by the reset — the backend revoked every one this
    // account had, deliberately. Signing in with the new password is both the
    // way back in and the proof it took.
    redirect(`/${tenantSlug}/login?notice=passwordReset`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="reset-password-title">
        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="reset-password-title">{tSection("title")}</h1>
          <p className="login-copy">{tSection("copy")}</p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error === "network"
              ? tSection("errorNetwork")
              : tSection("errorInvalid")}
          </div>
        ) : null}

        <form action={resetPasswordAction} className="form-stack">
          {token ? (
            <input name="token" type="hidden" value={token} />
          ) : (
            // Same manual fallback the invite screen keeps, for a link that
            // survived the trip as text but not as a link.
            <label>
              {tSection("token")}
              <input
                autoComplete="one-time-code"
                maxLength={INPUT_LIMITS.token}
                name="token"
                required
                type="text"
              />
              <span className="form-hint">{tSection("tokenHint")}</span>
            </label>
          )}
          <PasswordFields
            confirmLabel={tSection("passwordConfirm")}
            hideLabel={tCommon("hidePassword")}
            label={tSection("password")}
            minLength={8}
            mismatchMessage={tSection("passwordMismatch")}
            name="password"
            showLabel={tCommon("showPassword")}
          />
          <p className="form-hint">{tSection("signedOutNotice")}</p>
          {/* Like accepting an invite, this submit can only land once — the
              token is spent by the first one, and a second tap comes back as
              "this link is invalid". */}
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={tSection("submitting")}
          >
            {tSection("submit")}
          </PendingSubmitButton>
        </form>

        <Link className="auth-link" href={`/${tenantSlug}/password/forgot`}>
          {tSection("requestNew")}
        </Link>
      </section>
    </main>
  );
}
