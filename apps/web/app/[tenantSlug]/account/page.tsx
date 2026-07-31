import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BackLink } from "../../../components/back-link";
import { PasswordFields } from "../../../components/password-fields";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  buildApiUrl,
  buildRequestHeaders,
  getCurrentSession,
} from "../../../lib/api-client";
import { resolveBackTarget } from "../../../lib/back-navigation";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { getFormString } from "../../../lib/form";
import { INPUT_LIMITS } from "../../../lib/input-limits";
import {
  resolveZoneLanding,
  zoneHomePath,
  type Zone,
} from "../../../lib/navigation";

type AccountPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ changed?: string; error?: string; from?: string }>;
};

/**
 * The signed-in user's own account settings — today, just the password.
 *
 * Rendered as a standalone panel rather than inside the AppShell, because it is
 * the one screen that belongs to no zone: a rep reaches it from the field menu
 * and an admin from the sidebar, and giving it a `RoleArea` would have to pick
 * one of those zones for both. The back control instead lands on whichever zone
 * the session is currently in, resolved the same way the login redirect does.
 */
export default async function AccountPage({
  params,
  searchParams,
}: AccountPageProps) {
  const { tenantSlug } = await params;
  const { changed, error, from } = await searchParams;
  const [t, tCommon, sessionResult] = await Promise.all([
    getTranslations("account"),
    getTranslations("common"),
    getCurrentSession(),
  ]);

  // Unlike the zone screens, this one has no signed-out rendering to fall back
  // on: without a session there is no account to change the password of.
  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }

  const session = sessionResult.data;
  const landing = resolveZoneLanding(
    session.permissions,
    session.productsEnabled,
    session.user.lastSelectedZone,
    session.pilotActive,
  );
  const backZone: Zone | null = landing.kind === "zone" ? landing.zone : null;
  // Deep-link fallback: the home of whichever zone this session belongs to. The
  // opener (the field menu, the sidebar) states where it was, and that wins
  // when it names a real screen in the same zone — so returning lands back on
  // the list someone left rather than at the top of the zone.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: backZone
      ? `/${tenantSlug}${zoneHomePath(backZone)}`
      : `/${tenantSlug}/choose-zone`,
    labelKey: "home",
  });

  // Carried through every redirect below so a save doesn't reset the back link
  // to the zone home the deep-link fallback would pick.
  const backOriginParam = from ? `&from=${encodeURIComponent(from)}` : "";

  async function changePasswordAction(formData: FormData) {
    "use server";

    let response: Response;

    try {
      response = await fetch(buildApiUrl("/auth/password/change"), {
        method: "POST",
        cache: "no-store",
        headers: {
          // Carries the session and CSRF token: this is the one screen in the
          // flow whose call is authenticated.
          ...(await buildRequestHeaders("/auth/password/change")),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          currentPassword: getFormString(formData, "currentPassword"),
          newPassword: getFormString(formData, "newPassword"),
        }),
      });
    } catch {
      redirect(`/${tenantSlug}/account?error=network${backOriginParam}`);
    }

    if (!response.ok) {
      let code: string | undefined;

      try {
        code = ((await response.json()) as { code?: string }).code;
      } catch {
        // Non-JSON error body; fall through to the generic message.
      }

      if (code === "AUTHENTICATION_REQUIRED") {
        redirect(`/${tenantSlug}/login`);
      }

      redirect(
        `/${tenantSlug}/account?error=${
          code === "CURRENT_PASSWORD_INVALID" ? "current" : "invalid"
        }${backOriginParam}`,
      );
    }

    // The backend revoked every session for this account and issued a fresh one
    // for this caller. Forwarding its cookies is what keeps the person on this
    // screen instead of being bounced to login by their own password change.
    await forwardSetCookies(response.headers);
    redirect(`/${tenantSlug}/account?changed=1${backOriginParam}`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="account-title">
        <BackLink
          href={backTarget.href}
          inline
          label={tCommon(`back.${backTarget.labelKey}`)}
        />

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="account-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
          <p className="form-hint">
            {t("signedInAs", { email: session.user.email })}
          </p>
        </div>

        {changed ? (
          <div className="form-success" role="status">
            {t("success")}
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {error === "current"
              ? t("errorCurrent")
              : error === "network"
                ? t("errorNetwork")
                : t("errorInvalid")}
          </div>
        ) : null}

        <form action={changePasswordAction} className="form-stack">
          <label>
            {t("currentPassword")}
            <input
              autoComplete="current-password"
              maxLength={INPUT_LIMITS.password}
              name="currentPassword"
              required
              type="password"
            />
          </label>
          <PasswordFields
            confirmLabel={t("newPasswordConfirm")}
            hideLabel={tCommon("hidePassword")}
            label={t("newPassword")}
            minLength={8}
            mismatchMessage={t("passwordMismatch")}
            name="newPassword"
            showLabel={tCommon("showPassword")}
          />
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={t("submitting")}
          >
            {t("submit")}
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
