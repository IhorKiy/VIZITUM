import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BackLink } from "../../../components/back-link";
import { BrandMark } from "../../../components/brand-mark";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { changePassword, getCurrentSession } from "../../../lib/api-client";
import { getFormString } from "../../../lib/form";
import { INPUT_LIMITS } from "../../../lib/input-limits";
import { resolveZoneLanding, zoneHomePath } from "../../../lib/navigation";
import { resolveTenantBranding } from "../../../lib/tenant-branding";

type AccountPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ error?: string; changed?: string }>;
};

// A standalone surface rather than an AppShell screen, like choose-zone: the
// account belongs to no role zone (every signed-in user has one, whatever
// they can do), and AppShell's nav is built around the zone of the area it is
// given.
//
// That is also why the back control does not use the `?from=` machinery in
// lib/back-navigation.ts. That deliberately refuses an origin from a
// different zone than the resolving screen, and this screen is in none of
// them. The destination is knowable without an origin anyway — the zone the
// user is currently working in — so it is computed instead of carried.
export default async function AccountPage({
  params,
  searchParams,
}: AccountPageProps) {
  const { tenantSlug } = await params;
  const { error, changed } = await searchParams;
  const [t, tCommon, tZoneNames, sessionResult, branding] = await Promise.all([
    getTranslations("auth.account"),
    getTranslations("common"),
    getTranslations("common.zone.names"),
    getCurrentSession(),
    resolveTenantBranding(tenantSlug),
  ]);

  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }

  const landing = resolveZoneLanding(
    sessionResult.data.permissions,
    sessionResult.data.productsEnabled,
    sessionResult.data.user.lastSelectedZone,
    sessionResult.data.pilotActive,
  );
  // A user with several zones and no stored choice goes back to the chooser
  // rather than to an arbitrary one of them; a user with no zone at all can
  // still change their password, and returns to the screen that told them so.
  const backHref =
    landing.kind === "zone"
      ? `/${tenantSlug}${zoneHomePath(landing.zone)}`
      : landing.kind === "choose"
        ? `/${tenantSlug}/choose-zone`
        : `/${tenantSlug}/no-access`;
  const backLabel =
    landing.kind === "zone"
      ? tCommon("back.zone", { zone: tZoneNames(landing.zone) })
      : tCommon("back.home");

  async function changePasswordAction(formData: FormData) {
    "use server";

    const currentPassword = getFormString(formData, "currentPassword");
    const newPassword = getFormString(formData, "newPassword");
    const confirmPassword = getFormString(formData, "confirmPassword");

    if (newPassword !== confirmPassword) {
      redirect(`/${tenantSlug}/account?error=mismatch`);
    }

    // Mirrors the backend minimum so the one rule that needs no round trip
    // does not take one. The backend still enforces it.
    if (newPassword.length < 8) {
      redirect(`/${tenantSlug}/account?error=short`);
    }

    const result = await changePassword(currentPassword, newPassword);

    if (!result.ok) {
      const reason =
        result.code === "CURRENT_PASSWORD_INVALID"
          ? "current"
          : result.code === "PASSWORD_UNCHANGED"
            ? "unchanged"
            : result.code === "RATE_LIMITED"
              ? "rate"
              : "generic";

      redirect(`/${tenantSlug}/account?error=${reason}`);
    }

    redirect(
      `/${tenantSlug}/account?changed=${
        result.data.revokedOtherSessions > 0 ? "others" : "1"
      }`,
    );
  }

  return (
    <main className="login-surface">
      <section aria-labelledby="account-password-title" className="login-panel">
        <BackLink href={backHref} inline label={backLabel} />

        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="account-password-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
        </div>

        {changed ? (
          <div className="form-success" role="status">
            {changed === "others" ? t("successOtherDevices") : t("successBody")}
          </div>
        ) : null}

        {error ? (
          <div className="form-error" role="alert">
            {error === "mismatch"
              ? t("errorMismatch")
              : error === "short"
                ? t("errorTooShort")
                : error === "current"
                  ? t("errorCurrent")
                  : error === "unchanged"
                    ? t("errorUnchanged")
                    : error === "rate"
                      ? t("errorRateLimited")
                      : t("errorGeneric")}
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
          <label>
            {t("newPassword")}
            <input
              autoComplete="new-password"
              maxLength={INPUT_LIMITS.password}
              minLength={8}
              name="newPassword"
              required
              type="password"
            />
          </label>
          <label>
            {t("confirmPassword")}
            <input
              autoComplete="new-password"
              maxLength={INPUT_LIMITS.password}
              minLength={8}
              name="confirmPassword"
              required
              type="password"
            />
          </label>
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={t("submitPending")}
          >
            {t("submit")}
          </PendingSubmitButton>
        </form>
      </section>
    </main>
  );
}
