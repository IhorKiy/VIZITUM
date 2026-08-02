import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PasswordFields } from "../../../../components/password-fields";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import { forwardSetCookies } from "../../../../lib/backend-cookies";
import { buildApiUrl } from "../../../../lib/api-client";
import { getFormString } from "../../../../lib/form";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import { rememberWorkspace } from "../../../../lib/remembered-workspace";
import { resolveTenantBranding } from "../../../../lib/tenant-branding";

type AcceptInvitePageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function AcceptInvitePage({
  params,
  searchParams,
}: AcceptInvitePageProps) {
  const { tenantSlug } = await params;
  const { token = "", error } = await searchParams;
  // Branding is a cache hit on the tenant layout's fetch and is here for the
  // workspace name only; the rest resolve together like on every other
  // pre-auth screen rather than one await at a time.
  const [t, tCommon, branding] = await Promise.all([
    getTranslations("invites"),
    getTranslations("common"),
    resolveTenantBranding(tenantSlug),
  ]);

  async function acceptInviteAction(formData: FormData) {
    "use server";

    const response = await fetch(buildApiUrl("/auth/invites/accept"), {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        token: getFormString(formData, "token"),
        tenantSlug,
        firstName: getFormString(formData, "firstName"),
        lastName: getFormString(formData, "lastName"),
        password: getFormString(formData, "password"),
      }),
    });

    if (!response.ok) {
      redirect(`/${tenantSlug}/invites/accept?error=invalid`);
    }

    await forwardSetCookies(response.headers);
    // Accepting an invite is a first sign-in, not a lesser one — it mints the
    // account and its session in one step. For a field rep it is usually the
    // *only* entry they make before installing to the Home Screen, so leaving
    // it out would mean the entry screen forgot the one workspace they have
    // until they happened to sign in a second time.
    await rememberWorkspace(tenantSlug);
    redirect(`/${tenantSlug}/field`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="invite-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="invite-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {t("errorInvalid")}
          </div>
        ) : null}

        <form action={acceptInviteAction} className="form-stack">
          {token ? (
            <input name="token" type="hidden" value={token} />
          ) : (
            <label>
              {t("token")}
              <input
                autoComplete="one-time-code"
                maxLength={INPUT_LIMITS.token}
                name="token"
                required
                type="text"
              />
              <span className="form-hint">{t("tokenHint")}</span>
            </label>
          )}
          <label>
            {t("firstName")}
            <input
              autoComplete="given-name"
              maxLength={INPUT_LIMITS.name}
              name="firstName"
              required
              type="text"
            />
          </label>
          <label>
            {t("lastName")}
            <input
              autoComplete="family-name"
              maxLength={INPUT_LIMITS.name}
              name="lastName"
              required
              type="text"
            />
          </label>
          <PasswordFields
            confirmLabel={t("passwordConfirm")}
            hideLabel={tCommon("hidePassword")}
            label={t("password")}
            minLength={8}
            mismatchMessage={t("passwordMismatch")}
            name="password"
            showLabel={tCommon("showPassword")}
          />
          {/* The one submit in the product that can only be made once: a
              second tap re-sends a token the first one already consumed and
              comes back as "invite is invalid". */}
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={t("accepting")}
          >
            {t("accept")}
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
