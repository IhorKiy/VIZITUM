import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { BrandMark } from "../../../components/brand-mark";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { buildApiUrl, getCurrentSession } from "../../../lib/api-client";
import { resolveTenantBranding } from "../../../lib/tenant-branding";
import {
  normalizeTenantName,
  resolveZoneLanding,
  zoneHomePath,
} from "../../../lib/navigation";
import { getFormString } from "../../../lib/form";
import { INPUT_LIMITS } from "../../../lib/input-limits";

type LoginPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({
  params,
  searchParams,
}: LoginPageProps) {
  const { tenantSlug } = await params;
  const { error } = await searchParams;
  const [t, tCommon, branding] = await Promise.all([
    getTranslations("auth"),
    getTranslations("common"),
    resolveTenantBranding(tenantSlug),
  ]);

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
        }),
      });
    } catch {
      redirect(`/${tenantSlug}/login?error=network`);
    }

    if (!response.ok) {
      redirect(`/${tenantSlug}/login?error=invalid`);
    }

    await forwardSetCookies(response.headers);

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

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-block">
          <BrandMark logoUrl={branding.logoUrl} />
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="login-title">{t("title")}</h1>
          <p className="login-copy">{t("copy")}</p>
        </div>

        {error ? (
          <div className="form-error" role="alert">
            {error === "network" ? t("errorNetwork") : t("errorInvalid")}
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
          <button className="primary-button" type="submit">
            {tCommon("signIn")}
          </button>
        </form>
      </section>
    </main>
  );
}
