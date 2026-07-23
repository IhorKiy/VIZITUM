import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PhoneInput } from "../../../../components/phone-input";
import { forwardSetCookies } from "../../../../lib/backend-cookies";
import { buildApiUrl } from "../../../../lib/api-client";
import { normalizeTenantName } from "../../../../lib/navigation";
import { getFormString } from "../../../../lib/form";
import { resolveTenantLocale } from "../../../../lib/tenant-locale";

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
  const t = await getTranslations("invites");
  const tCommon = await getTranslations("common");
  const { phoneCountry } = await resolveTenantLocale(tenantSlug);

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
        name: getFormString(formData, "name"),
        password: getFormString(formData, "password"),
        phone: getFormString(formData, "phone"),
      }),
    });

    if (!response.ok) {
      redirect(`/${tenantSlug}/invites/accept?error=invalid`);
    }

    await forwardSetCookies(response.headers);
    redirect(`/${tenantSlug}/field`);
  }

  return (
    <main className="login-surface">
      <section className="login-panel" aria-labelledby="invite-title">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">Vizitum</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
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
                name="token"
                required
                type="text"
              />
            </label>
          )}
          <label>
            {t("fullName")}
            <input autoComplete="name" name="name" required type="text" />
          </label>
          <label>
            {t("phone")}
            <PhoneInput
              countryRequiredMessage={tCommon("phoneInternationalRequired")}
              invalidMessage={tCommon("phoneInvalid")}
              name="phone"
              phoneCountry={phoneCountry}
            />
          </label>
          <label>
            {t("password")}
            <input
              autoComplete="new-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <button className="primary-button" type="submit">
            {t("accept")}
          </button>
        </form>
      </section>
    </main>
  );
}
