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
import { CreateTenantModal } from "./create-tenant-modal";

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
    <main className="page platform-page">
      <header className="page-header">
        <div>
          <h1>VIZITUM</h1>
          <p>platform</p>
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
            Could not create the tenant. Check name, slug and segment template,
            or that the slug is not already in use.
          </p>
        </section>
      ) : null}

      <CreateTenantModal
        action={createTenantAction}
        segmentTemplates={SEGMENT_TEMPLATES}
      />

      <section
        className="platform-tenants-section"
        aria-label="Existing tenants"
      >
        <h2>Existing tenants</h2>
        {tenantsResult.ok ? (
          <div className="tenant-collapse-list">
            {tenantsResult.data.map((tenant) => {
              const isArchived = tenant.status === "archived";

              return (
                <details className="tenant-collapse" key={tenant.id}>
                  <summary>{tenant.name}</summary>
                  <div className="tenant-collapse-body">
                    <dl className="tenant-detail-grid">
                      <div>
                        <dt>Slug</dt>
                        <dd>{tenant.slug}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{tenant.status}</dd>
                      </div>
                      <div>
                        <dt>Plan</dt>
                        <dd>{tenant.planCode}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd>{new Date(tenant.createdAt).toLocaleString()}</dd>
                      </div>
                    </dl>

                    {isArchived ? (
                      <p className="tenant-archived-note">Archived</p>
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
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <p>{tenantsResult.message}</p>
        )}
      </section>
    </main>
  );
}
