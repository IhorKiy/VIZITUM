import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  getAdminSettings,
  updateAdminSettings,
} from "../../../../lib/api-client";
import { getFormString } from "../../../../lib/form";

type AdminSettingsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

export default async function AdminSettingsPage({
  params,
  searchParams,
}: AdminSettingsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.settings"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);

  async function updateSettingsAction(formData: FormData) {
    "use server";

    const name = getFormString(formData, "name").trim();
    const timezone = getFormString(formData, "timezone").trim();
    const language = getFormString(formData, "language").trim();
    const productsEnabled = formData.get("productsEnabled") === "on";

    if (!name || !timezone || !language) {
      redirect(`/${tenantSlug}/admin/settings?error=1`);
    }

    const result = await updateAdminSettings({
      name,
      timezone,
      language,
      productsEnabled,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/settings?error=1`);
    }

    redirect(`/${tenantSlug}/admin/settings?saved=1`);
  }

  const settingsResult = await getAdminSettings();

  if (!settingsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-settings">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{settingsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const settings = settingsResult.data;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-settings">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      {pageState.saved ? (
        <DismissableNotice
          ariaLabel={t("savedAria")}
          body={t("savedBody")}
          clearParams={["saved"]}
          eyebrow={t("savedEyebrow")}
          title={t("savedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
          tone="danger"
        />
      ) : null}

      <section className="manager-grid" aria-label={t("identityAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("productMode")}</p>
            <span className="status-pill info">{t("fixed")}</span>
          </header>
          <p className="metric-value">
            {formatProductMode(settings.productMode)}
          </p>
          <p className="small-label">{t("productModeHint")}</p>
        </article>
      </section>

      <section className="admin-users-grid">
        <div className="panel">
          <div className="panel-title-stack">
            <h2>{t("companyIdentity")}</h2>
            <p>{t("companyIdentityBody")}</p>
          </div>
          <form action={updateSettingsAction} className="visit-form compact">
            <label>
              {t("companyName")}
              <input
                defaultValue={settings.name}
                maxLength={200}
                name="name"
                required
                type="text"
              />
            </label>
            <label>
              {t("timezone")}
              <input
                defaultValue={settings.timezone}
                name="timezone"
                placeholder="Europe/Kiev"
                required
                type="text"
              />
            </label>
            <label>
              {t("language")}
              <select defaultValue={settings.language} name="language" required>
                <option value="en">{t("languageEnglish")}</option>
                <option value="uk">{t("languageUkrainian")}</option>
              </select>
              <span className="form-hint">{t("languageHint")}</span>
            </label>
            <label className="checkbox-inline">
              <input
                defaultChecked={settings.productsEnabled}
                name="productsEnabled"
                type="checkbox"
              />
              <span>{t("productsEnabled")}</span>
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={tCommon("saving")}
            >
              {t("saveSettings")}
            </PendingSubmitButton>
          </form>
        </div>
      </section>
    </AppShell>
  );
}

function formatProductMode(productMode: string): string {
  return productMode
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
