import { redirect } from "next/navigation";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  archivePlatformTenant,
  buildApiUrl,
  buildRequestHeaders,
  createPlatformTenant,
  getPlatformSession,
  listPlatformTenants,
  updatePlatformTenant,
  type PlatformSegmentTemplate,
} from "../../../lib/api-client";
import { forwardSetCookies } from "../../../lib/backend-cookies";

const SEGMENT_TEMPLATES: PlatformSegmentTemplate[] = [
  "distribution",
  "service",
  "partner_account",
];

// Statuses a platform owner can assign directly; `archived` is handled by the
// dedicated archive action so it always stamps `archivedAt` server-side.
const ASSIGNABLE_STATUSES = [
  "draft",
  "provisioning",
  "ready",
  "pilot_active",
  "active",
  "suspended",
];

type PlatformTenantsPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

export default async function PlatformTenantsPage({
  searchParams,
}: PlatformTenantsPageProps) {
  const pageState = await searchParams;

  const sessionResult = await getPlatformSession();

  if (!sessionResult.ok) {
    redirect("/platform/login");
  }

  async function logoutAction() {
    "use server";

    try {
      const response = await fetch(buildApiUrl("/platform/auth/logout"), {
        method: "POST",
        cache: "no-store",
        headers: await buildRequestHeaders(),
      });
      await forwardSetCookies(response.headers);
    } catch {
      // Even if the API call fails, fall through to the login screen.
    }

    redirect("/platform/login");
  }

  async function createTenantAction(formData: FormData) {
    "use server";

    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const segmentTemplate = String(
      formData.get("segmentTemplate") ?? "",
    ) as PlatformSegmentTemplate;
    const country = String(formData.get("country") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "").trim();
    const language = String(formData.get("language") ?? "").trim();
    const primaryDomain = String(formData.get("primaryDomain") ?? "").trim();

    if (!name || !slug || !SEGMENT_TEMPLATES.includes(segmentTemplate)) {
      redirect("/platform/tenants?error=1");
    }

    const result = await createPlatformTenant({
      name,
      slug,
      segmentTemplate,
      country: country || undefined,
      timezone: timezone || undefined,
      language: language || undefined,
      primaryDomain: primaryDomain || undefined,
    });

    if (!result.ok) {
      redirect("/platform/tenants?error=1");
    }

    redirect("/platform/tenants?saved=1");
  }

  async function updateStatusAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const status = String(formData.get("status") ?? "").trim();

    if (!tenantId || !ASSIGNABLE_STATUSES.includes(status)) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenant(tenantId, { status });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function archiveAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();

    if (!tenantId) {
      redirect("/platform/tenants?error=1");
    }

    const result = await archivePlatformTenant(tenantId);

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  const tenantsResult = await listPlatformTenants();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform owner</p>
          <h1>Tenants</h1>
          <p>
            Create and provision new tenants. Signed in as{" "}
            {sessionResult.data.platformUser.email}.
          </p>
        </div>
        <div className="toolbar">
          <form action={logoutAction}>
            <PendingSubmitButton
              className="secondary-button"
              pendingLabel="Signing out..."
            >
              Sign out
            </PendingSubmitButton>
          </form>
        </div>
      </header>

      {pageState.saved ? (
        <section className="notice-panel success" aria-label="Save status">
          <p>Tenant created and queued for provisioning.</p>
        </section>
      ) : null}
      {pageState.error ? (
        <section className="notice-panel danger" aria-label="Save status">
          <p>
            Could not create the tenant. Check name, slug and segment
            template, or that the slug is not already in use.
          </p>
        </section>
      ) : null}

      <section aria-label="Create tenant">
        <form action={createTenantAction} className="visit-form compact">
          <label>
            Name
            <input name="name" type="text" required />
          </label>
          <label>
            Slug
            <input name="slug" type="text" required />
          </label>
          <label>
            Segment template
            <select name="segmentTemplate" required defaultValue="">
              <option value="" disabled>
                Select a template
              </option>
              {SEGMENT_TEMPLATES.map((template) => (
                <option key={template} value={template}>
                  {template}
                </option>
              ))}
            </select>
          </label>
          <label>
            Country
            <input name="country" type="text" placeholder="UA" />
          </label>
          <label>
            Timezone
            <input name="timezone" type="text" placeholder="Europe/Kiev" />
          </label>
          <label>
            Language
            <input name="language" type="text" placeholder="uk" />
          </label>
          <label>
            Primary domain
            <input name="primaryDomain" type="text" />
          </label>
          <PendingSubmitButton className="primary-button">
            Create tenant
          </PendingSubmitButton>
        </form>
      </section>

      <section aria-label="Existing tenants">
        <h2>Existing tenants</h2>
        {tenantsResult.ok ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenantsResult.data.map((tenant) => {
                const isArchived = tenant.status === "archived";

                return (
                  <tr key={tenant.id}>
                    <td>{tenant.name}</td>
                    <td>{tenant.slug}</td>
                    <td>{tenant.status}</td>
                    <td>{tenant.planCode}</td>
                    <td>{new Date(tenant.createdAt).toLocaleString()}</td>
                    <td>
                      {isArchived ? (
                        <span>Archived</span>
                      ) : (
                        <div className="toolbar">
                          <form action={updateStatusAction}>
                            <input
                              type="hidden"
                              name="tenantId"
                              value={tenant.id}
                            />
                            <select
                              name="status"
                              defaultValue={tenant.status}
                              aria-label={`Status for ${tenant.name}`}
                            >
                              {ASSIGNABLE_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                            <PendingSubmitButton className="secondary-button">
                              Save status
                            </PendingSubmitButton>
                          </form>
                          <form action={archiveAction}>
                            <input
                              type="hidden"
                              name="tenantId"
                              value={tenant.id}
                            />
                            <PendingSubmitButton
                              className="secondary-button"
                              pendingLabel="Archiving..."
                            >
                              Archive
                            </PendingSubmitButton>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p>{tenantsResult.message}</p>
        )}
      </section>
    </main>
  );
}
