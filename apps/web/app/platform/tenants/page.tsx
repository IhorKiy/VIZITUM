import { redirect } from "next/navigation";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  archivePlatformTenant,
  buildApiUrl,
  buildRequestHeaders,
  createPlatformTenant,
  getPlatformSession,
  invitePlatformTenantUser,
  listPlatformTenantUsers,
  listPlatformTenants,
  updatePlatformTenantAdminStatus,
  updatePlatformTenant,
  type PlatformSegmentTemplate,
} from "../../../lib/api-client";
import { forwardSetCookies } from "../../../lib/backend-cookies";
import { AutoDismissNotice } from "./auto-dismiss-notice";
import { CreateTenantModal } from "./create-tenant-modal";
import { NameChangeForm } from "./name-change-form";
import { StatusChangeForm } from "./status-change-form";
import { TenantAdminControls } from "./tenant-admin-controls";

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
const EMPTY_TENANT_METRICS = {
  companyAdminCount: 0,
  teamManagerCount: 0,
  fieldRepresentativeCount: 0,
  visitCount: 0,
  productCount: 0,
  locationCount: 0,
};
const SAVED_NOTICE_PARAMS = ["saved"];
const ERROR_NOTICE_PARAMS = ["error"];

type PlatformTenantsPageProps = {
  searchParams: Promise<{
    error?: string;
    inviteEmail?: string;
    inviteTenantSlug?: string;
    inviteToken?: string;
    invited?: string;
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

  async function updateNameAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();

    if (!tenantId || !name) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenant(tenantId, { name });

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

  async function inviteTenantUserAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const tenantSlug = String(formData.get("tenantSlug") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();

    if (!tenantId || !tenantSlug || !email) {
      redirect("/platform/tenants?error=invite");
    }

    const result = await invitePlatformTenantUser(tenantId, {
      email,
    });

    if (!result.ok) {
      redirect("/platform/tenants?error=invite");
    }

    const query = new URLSearchParams({
      inviteEmail: result.data.email,
      inviteTenantSlug: tenantSlug,
      inviteToken: result.data.token,
      invited: "1",
    });

    redirect(`/platform/tenants?${query.toString()}`);
  }

  async function updateTenantAdminStatusAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const userId = String(formData.get("userId") ?? "").trim();
    const status = String(formData.get("status") ?? "").trim();

    if (
      !tenantId ||
      !userId ||
      (status !== "active" && status !== "suspended")
    ) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenantAdminStatus(
      tenantId,
      userId,
      status,
    );

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  const tenantsResult = await listPlatformTenants();
  const tenantUsersByTenantId = tenantsResult.ok
    ? await Promise.all(
        tenantsResult.data.map(async (tenant) => ({
          tenantId: tenant.id,
          result:
            tenant.status === "archived"
              ? null
              : await listPlatformTenantUsers(tenant.id),
        })),
      )
    : [];
  const inviteLink =
    pageState.inviteToken && pageState.inviteTenantSlug
      ? `/${pageState.inviteTenantSlug}/invites/accept?token=${encodeURIComponent(
          pageState.inviteToken,
        )}`
      : null;

  return (
    <main className="page platform-page">
      <header className="page-header">
        <div>
          <h1>VIZITUM</h1>
          <p>platform</p>
        </div>
        <div className="toolbar">
          <CreateTenantModal
            action={createTenantAction}
            segmentTemplates={SEGMENT_TEMPLATES}
          />
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
        <AutoDismissNotice
          ariaLabel="Save status"
          className="notice-panel success"
          clearParams={SAVED_NOTICE_PARAMS}
        >
          <p>Tenant created and queued for provisioning.</p>
        </AutoDismissNotice>
      ) : null}
      {pageState.invited ? (
        <section className="notice-panel success" aria-label="Invite status">
          <div>
            <p className="eyebrow">Invite created</p>
            <h2>Company Admin invite is ready</h2>
            <p>
              The invite was created
              {pageState.inviteEmail ? ` for ${pageState.inviteEmail}` : ""}.
              Share this link through a trusted channel.
            </p>
            {inviteLink ? (
              <code className="copyable-value">{inviteLink}</code>
            ) : null}
          </div>
        </section>
      ) : null}
      {pageState.error ? (
        <AutoDismissNotice
          ariaLabel="Save status"
          className="notice-panel danger"
          clearParams={ERROR_NOTICE_PARAMS}
        >
          <p>
            Could not save the platform action. Check tenant status, duplicate
            email addresses, required roles and tenant fields.
          </p>
        </AutoDismissNotice>
      ) : null}

      <section className="platform-tenants-section" aria-label="Tenants">
        <h2>Tenants</h2>
        {tenantsResult.ok ? (
          <div className="tenant-collapse-list">
            {tenantsResult.data.map((tenant) => {
              const isArchived = tenant.status === "archived";
              const usersResult = tenantUsersByTenantId.find(
                (entry) => entry.tenantId === tenant.id,
              )?.result;
              const users = usersResult?.ok ? usersResult.data.items : [];
              const companyAdmins = users.filter((user) =>
                user.roleCodes.includes("company_admin"),
              );
              const metrics = tenant.metrics ?? EMPTY_TENANT_METRICS;

              return (
                <details
                  className="tenant-collapse"
                  key={tenant.id}
                  name="platform-tenant"
                >
                  <summary>{tenant.name}</summary>
                  <div className="tenant-collapse-body">
                    <dl className="tenant-detail-grid">
                      <div>
                        <dt>Slug</dt>
                        <dd>{tenant.slug}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>
                          <span className="tenant-status-chip">
                            {tenant.status}
                          </span>
                        </dd>
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

                    <section
                      className="tenant-metrics-block"
                      aria-label={`${tenant.name} tenant information`}
                    >
                      <h3>Tenant information</h3>
                      <dl className="tenant-metrics-grid">
                        <div>
                          <dt>Admins</dt>
                          <dd className="tenant-admin-metric-value">
                            <span>{metrics.companyAdminCount}</span>
                            <TenantAdminControls
                              admins={companyAdmins}
                              inviteAction={inviteTenantUserAction}
                              isArchived={isArchived}
                              tenantId={tenant.id}
                              tenantName={tenant.name}
                              tenantSlug={tenant.slug}
                              updateStatusAction={updateTenantAdminStatusAction}
                              usersAvailable={Boolean(usersResult?.ok)}
                            />
                          </dd>
                        </div>
                        <div>
                          <dt>Managers</dt>
                          <dd>{metrics.teamManagerCount}</dd>
                        </div>
                        <div>
                          <dt>Representatives</dt>
                          <dd>{metrics.fieldRepresentativeCount}</dd>
                        </div>
                        <div>
                          <dt>Visits</dt>
                          <dd>{metrics.visitCount}</dd>
                        </div>
                        <div>
                          <dt>Products</dt>
                          <dd>{metrics.productCount}</dd>
                        </div>
                        <div>
                          <dt>Locations</dt>
                          <dd>{metrics.locationCount}</dd>
                        </div>
                      </dl>
                    </section>

                    {isArchived ? (
                      <p className="tenant-archived-note">Archived</p>
                    ) : (
                      <div className="toolbar">
                        <NameChangeForm
                          action={updateNameAction}
                          currentName={tenant.name}
                          tenantId={tenant.id}
                        />
                        <StatusChangeForm
                          archiveAction={archiveAction}
                          currentStatus={tenant.status}
                          statuses={[...ASSIGNABLE_STATUSES, "archived"]}
                          tenantId={tenant.id}
                          tenantName={tenant.name}
                          updateAction={updateStatusAction}
                        />
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
