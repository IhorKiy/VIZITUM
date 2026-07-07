import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { forwardSetCookies } from "../../../lib/backend-cookies";
import { buildApiUrl } from "../../../lib/api-client";
import { normalizeTenantName } from "../../../lib/navigation";

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
  const [t, tCommon] = await Promise.all([
    getTranslations("auth"),
    getTranslations("common"),
  ]);

  async function loginAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
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
    redirect(`/${tenantSlug}/field`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
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
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            {t("password")}
            <input
              autoComplete="current-password"
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
