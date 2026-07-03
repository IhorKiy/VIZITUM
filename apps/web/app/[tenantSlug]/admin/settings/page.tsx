import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  getAdminSettings,
  updateAdminSettings,
} from "../../../../lib/api-client";

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

  async function updateSettingsAction(formData: FormData) {
    "use server";

    const name = String(formData.get("name") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "").trim();
    const productsEnabled = formData.get("productsEnabled") === "on";

    if (!name || !timezone) {
      redirect(`/${tenantSlug}/admin/settings?error=1`);
    }

    const result = await updateAdminSettings({
      name,
      timezone,
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
            <p className="eyebrow">Company admin</p>
            <h1>Company settings</h1>
            <p>
              Tenant identity settings are required in production before this
              screen can load.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Tenant settings are not connected</h2>
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
          <p className="eyebrow">Company admin</p>
          <h1>Company settings</h1>
          <p>
            Set the company display name, time zone and whether product/SKU
            tracking applies to this tenant.
          </p>
        </div>
      </header>

      {pageState.saved ? (
        <section className="notice-panel success" aria-label="Settings status">
          <div>
            <p className="eyebrow">Settings saved</p>
            <h2>Company settings were updated</h2>
            <p>The change applies to this tenant immediately.</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label="Settings error">
          <div>
            <p className="eyebrow">Update failed</p>
            <h2>Check the settings and try again</h2>
            <p>
              Company name is required and the time zone must be a valid IANA
              time zone, such as Europe/Kiev.
            </p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Tenant identity">
        <article className="metric-card">
          <header>
            <p className="metric-label">Product mode</p>
            <span className="status-pill info">Fixed</span>
          </header>
          <p className="metric-value">
            {formatProductMode(settings.productMode)}
          </p>
          <p className="small-label">
            Team Pilot product mode is set during tenant provisioning.
          </p>
        </article>
      </section>

      <section className="admin-users-grid">
        <div className="panel">
          <div className="panel-title-stack">
            <h2>Company identity</h2>
            <p>
              This name and time zone appear across tenant screens and
              scheduling.
            </p>
          </div>
          <form action={updateSettingsAction} className="visit-form compact">
            <label>
              Company display name
              <input
                defaultValue={settings.name}
                maxLength={200}
                name="name"
                required
                type="text"
              />
            </label>
            <label>
              Time zone (IANA)
              <input
                defaultValue={settings.timezone}
                name="timezone"
                placeholder="Europe/Kiev"
                required
                type="text"
              />
            </label>
            <label className="checkbox-inline">
              <input
                defaultChecked={settings.productsEnabled}
                name="productsEnabled"
                type="checkbox"
              />
              <span>Product/SKU tracking applies to this tenant</span>
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Saving..."
            >
              Save settings
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
