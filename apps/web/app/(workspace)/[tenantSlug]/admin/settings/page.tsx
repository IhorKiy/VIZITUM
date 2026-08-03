import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  deleteTenantLogo,
  getAdminSettings,
  updateAdminSettings,
  uploadTenantLogo,
} from "../../../../../lib/api-client";
import {
  SCHEME_SWATCHES,
  TENANT_COLOR_SCHEMES,
} from "../../../../../lib/branding";
import { getFormString } from "../../../../../lib/form";
import { INPUT_LIMITS } from "../../../../../lib/input-limits";

type AdminSettingsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Query params the imports flow used while it lived on this page. Old
// bookmarks and import-history links carry them — forward those requests to
// the dedicated imports page (the exact inverse of the redirect stub that
// used to live at admin/imports).
const IMPORT_FLOW_PARAMS = [
  "applied",
  "canConfirm",
  "importJobId",
  "rows",
  "status",
  "template",
  "valid",
  "warnings",
];
const IMPORT_FLOW_ERRORS = new Set(["upload", "validation", "confirm"]);

function buildImportRedirectQuery(
  query: Record<string, string | string[] | undefined>,
): string | null {
  const single = (value: string | string[] | undefined) =>
    typeof value === "string"
      ? value
      : Array.isArray(value) && value.length > 0
        ? value[value.length - 1]
        : undefined;

  const errorValue = single(query.error);
  const isImportRequest =
    IMPORT_FLOW_PARAMS.some((param) => single(query[param]) !== undefined) ||
    (errorValue !== undefined && IMPORT_FLOW_ERRORS.has(errorValue));

  if (!isImportRequest) {
    return null;
  }

  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const resolved = single(value);
    if (resolved !== undefined) {
      forwarded.set(key, resolved);
    }
  }

  return forwarded.toString();
}

export default async function AdminSettingsPage({
  params,
  searchParams,
}: AdminSettingsPageProps) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const importRedirectQuery = buildImportRedirectQuery(query);
  if (importRedirectQuery !== null) {
    redirect(
      `/${tenantSlug}/admin/imports${importRedirectQuery ? `?${importRedirectQuery}` : ""}`,
    );
  }

  const saved = typeof query.saved === "string" ? query.saved : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;

  const [tSettings, tBranding, tSchemes, tAdmin, tCommon, settingsResult] =
    await Promise.all([
      getTranslations("admin.settings"),
      getTranslations("admin.branding"),
      getTranslations("admin.branding.schemes"),
      getTranslations("admin"),
      getTranslations("common"),
      getAdminSettings(),
    ]);

  async function updateColorSchemeAction(formData: FormData) {
    "use server";

    const colorScheme = getFormString(formData, "colorScheme").trim();

    if (!colorScheme) {
      redirect(`/${tenantSlug}/admin/settings?error=colors`);
    }

    const result = await updateAdminSettings({ colorScheme });

    if (result.ok) {
      // The color-scheme <style> lives in the tenant layout, which the App
      // Router caches across soft navigations — without this the new palette
      // only shows up after a hard reload.
      revalidatePath(`/${tenantSlug}`, "layout");
    }

    redirect(
      `/${tenantSlug}/admin/settings?${result.ok ? "saved=colors" : "error=colors"}`,
    );
  }

  async function updateLocationCategoriesEnabledAction(formData: FormData) {
    "use server";

    const locationCategoriesEnabled =
      formData.get("locationCategoriesEnabled") === "on";

    const result = await updateAdminSettings({ locationCategoriesEnabled });

    redirect(
      `/${tenantSlug}/admin/settings?${
        result.ok ? "saved=locationCategories" : "error=locationCategories"
      }`,
    );
  }

  async function updateVoiceHintAction(formData: FormData) {
    "use server";

    const fieldReportVoiceHint = getFormString(
      formData,
      "fieldReportVoiceHint",
    );

    const result = await updateAdminSettings({ fieldReportVoiceHint });

    redirect(
      `/${tenantSlug}/admin/settings?${
        result.ok ? "saved=voiceHint" : "error=voiceHint"
      }`,
    );
  }

  async function uploadLogoAction(formData: FormData) {
    "use server";

    const logoFile = formData.get("logoFile");

    if (!(logoFile instanceof File) || logoFile.size === 0) {
      redirect(`/${tenantSlug}/admin/settings?error=logo`);
    }

    const result = await uploadTenantLogo(logoFile);

    if (result.ok) {
      revalidatePath(`/${tenantSlug}`, "layout");
    }

    redirect(
      `/${tenantSlug}/admin/settings?${result.ok ? "saved=logo" : "error=logo"}`,
    );
  }

  async function removeLogoAction() {
    "use server";

    const result = await deleteTenantLogo();

    if (result.ok) {
      revalidatePath(`/${tenantSlug}`, "layout");
    }

    redirect(
      `/${tenantSlug}/admin/settings?${result.ok ? "saved=logoRemoved" : "error=logo"}`,
    );
  }

  if (!settingsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-settings">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{tSettings("title")}</h1>
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
            <h2>{tSettings("notConnectedTitle")}</h2>
            <p>{settingsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const settings = settingsResult.data;
  const savedMessages: Record<string, string> = {
    colors: tBranding("savedColorsTitle"),
    logo: tBranding("savedLogoTitle"),
    logoRemoved: tBranding("removedLogoTitle"),
    locationCategories: tSettings("locationCategoriesSavedTitle"),
    voiceHint: tSettings("voiceHintSavedTitle"),
  };
  const savedMessage = saved ? savedMessages[saved] : undefined;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-settings">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{tSettings("title")}</h1>
        </div>
      </header>

      {savedMessage ? (
        <DismissableNotice
          ariaLabel={tBranding("savedAria")}
          clearParams={["saved"]}
          eyebrow={tCommon("notice.updated")}
          title={savedMessage}
          tone="success"
        />
      ) : null}

      {error && error !== "locationCategories" && error !== "voiceHint" ? (
        <DismissableNotice
          ariaLabel={tBranding("errorAria")}
          body={tBranding("errorBody")}
          clearParams={["error"]}
          eyebrow={tBranding("errorEyebrow")}
          title={tBranding("errorTitle")}
          tone="danger"
        />
      ) : null}

      {error === "locationCategories" || error === "voiceHint" ? (
        <DismissableNotice
          ariaLabel={tSettings("errorAria")}
          body={tSettings("errorBody")}
          clearParams={["error"]}
          eyebrow={tSettings("errorEyebrow")}
          title={tSettings("errorTitle")}
          tone="danger"
        />
      ) : null}

      <div className="admin-accordion-stack">
        <section className="panel">
          <h2>{tBranding("colorTitle")}</h2>
          <p className="form-hint">{tBranding("colorHint")}</p>
          <form action={updateColorSchemeAction} className="field-stack">
            <div className="scheme-swatch-grid">
              {TENANT_COLOR_SCHEMES.map((scheme) => (
                <label className="scheme-swatch" key={scheme}>
                  <input
                    defaultChecked={settings.colorScheme === scheme}
                    name="colorScheme"
                    type="radio"
                    value={scheme}
                  />
                  <span aria-hidden="true" className="scheme-swatch-chips">
                    <span
                      className="scheme-swatch-chip"
                      style={{ background: SCHEME_SWATCHES[scheme].accent }}
                    />
                    <span
                      className="scheme-swatch-chip"
                      style={{ background: SCHEME_SWATCHES[scheme].sidebar }}
                    />
                  </span>
                  <span className="scheme-swatch-name">{tSchemes(scheme)}</span>
                </label>
              ))}
            </div>
            <div>
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={tBranding("saving")}
              >
                {tBranding("saveColors")}
              </PendingSubmitButton>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>{tBranding("logoTitle")}</h2>
          <p className="form-hint">{tBranding("logoHint")}</p>
          <div className="logo-preview-row">
            {settings.logo ? (
              <img
                alt={tBranding("logoAlt")}
                className="logo-preview"
                src={settings.logo.url}
              />
            ) : (
              <span className="logo-preview-empty">{tBranding("noLogo")}</span>
            )}
            <div className="logo-controls">
              <form action={uploadLogoAction} className="logo-upload-form">
                <input
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
                  aria-label={tBranding("logoFileLabel")}
                  name="logoFile"
                  required
                  type="file"
                />
                <PendingSubmitButton
                  className="primary-button"
                  pendingLabel={tBranding("uploading")}
                >
                  {settings.logo
                    ? tBranding("replaceLogo")
                    : tBranding("uploadLogo")}
                </PendingSubmitButton>
              </form>
              {settings.logo ? (
                <form action={removeLogoAction}>
                  <PendingSubmitButton
                    className="secondary-button"
                    pendingLabel={tBranding("removing")}
                  >
                    {tBranding("removeLogo")}
                  </PendingSubmitButton>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>{tSettings("voiceHintTitle")}</h2>
          <p className="form-hint">{tSettings("voiceHintHint")}</p>
          <form action={updateVoiceHintAction} className="field-stack">
            <textarea
              aria-label={tSettings("voiceHintTitle")}
              className="voice-hint-textarea"
              defaultValue={settings.fieldReportVoiceHint ?? ""}
              maxLength={INPUT_LIMITS.notes}
              name="fieldReportVoiceHint"
              placeholder={tSettings("voiceHintPlaceholder")}
              rows={6}
            />
            <div>
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={tCommon("saving")}
              >
                {tCommon("save")}
              </PendingSubmitButton>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2>{tSettings("locationCategoriesTitle")}</h2>
          <p className="form-hint">{tSettings("locationCategoriesHint")}</p>
          <form
            action={updateLocationCategoriesEnabledAction}
            className="field-stack"
          >
            <label className="checkbox-label">
              <input
                defaultChecked={settings.locationCategoriesEnabled}
                name="locationCategoriesEnabled"
                type="checkbox"
              />
              {tSettings("locationCategoriesToggleLabel")}
            </label>
            <div>
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={tCommon("saving")}
              >
                {tCommon("save")}
              </PendingSubmitButton>
            </div>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
