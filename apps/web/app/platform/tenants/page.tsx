import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  archivePlatformTenant,
  buildApiUrl,
  buildRequestHeaders,
  createPlatformTenant,
  getPlatformSession,
  invitePlatformTenantSuperadmin,
  listPlatformTenantUsers,
  listPlatformTenants,
  PLATFORM_CSRF_COOKIE_NAME,
  PLATFORM_SESSION_COOKIE_NAME,
  promotePlatformTenantSuperadmin,
  requestPlatformTenantPurge,
  unarchivePlatformTenant,
  updatePlatformTenant,
  type PlatformSegmentTemplate,
  type PlatformTenant,
  type TenantSuperadminSummary,
  type TenantUser,
} from "../../../lib/api-client";
import { clearCookies } from "../../../lib/backend-cookies";
import { getFormatter } from "next-intl/server";

import { formatLabel, formatShortDate } from "../../../lib/format";
import { AdminLimitForm } from "./admin-limit-form";
import { ArchiveTenantForm } from "./archive-tenant-form";
import { AutoDismissNotice } from "./auto-dismiss-notice";
import { CreateTenantModal } from "./create-tenant-modal";
import { NameChangeForm } from "./name-change-form";
import { PurgeTenantForm } from "./purge-tenant-form";
import { SingleFieldForm } from "./single-field-form";
import { StatusChangeForm } from "./status-change-form";
import { TenantAdminControls } from "./tenant-admin-controls";
import { LanguageForm } from "./language-form";
import { TimezoneForm } from "./timezone-form";

const SEGMENT_TEMPLATES: PlatformSegmentTemplate[] = [
  "distribution",
  "service",
  "partner_account",
];

// Status doubles as the plan tier — there is no separate plan field. Statuses
// a platform owner can assign directly: `pilot`/`team`/`business` (the plan)
// and `suspended` (paused). `archived` is handled by the dedicated archive
// action so it always stamps `archivedAt` server-side; `draft`/`provisioning`/
// `ready`/`active` are retired — tenants are created straight into `pilot` and
// nothing advances them through those legacy states anymore.
const ASSIGNABLE_STATUSES = ["pilot", "team", "business", "suspended"];
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
// The invite token is a secret share-link, so it is passed to the confirmation
// render through a short-lived httpOnly cookie instead of the URL (which would
// leak it into browser history, the Referer header and server access logs).
const INVITE_FLASH_COOKIE = "platform_invite_flash";
const INVITE_FLASH_MAX_AGE_SECONDS = 120;

type InviteFlash = {
  email: string;
  tenantSlug: string;
  token: string;
};

type PlatformTenantsPageProps = {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    saved?: string;
  }>;
};

export default async function PlatformTenantsPage({
  searchParams,
}: PlatformTenantsPageProps) {
  const pageState = await searchParams;
  const format = await getFormatter();

  const sessionResult = await getPlatformSession();

  if (!sessionResult.ok) {
    redirect("/platform/login");
  }

  async function logoutAction() {
    "use server";

    try {
      // Only the server-side revocation matters here (logout is CSRF-exempt,
      // so a stale CSRF cookie can't block it). The response's Set-Cookie
      // headers only clear the same two cookies removed below, so they are
      // deliberately not forwarded.
      await fetch(buildApiUrl("/platform/auth/logout"), {
        method: "POST",
        cache: "no-store",
        headers: await buildRequestHeaders("/platform/auth/logout"),
      });
    } catch {
      // Fall through: the cookies still get cleared below.
    }

    // Never rely on the API call alone to end the session: a network error
    // (or backend outage) means nothing was revoked server-side, yet the UI
    // is about to tell the user they're logged out. The browser must not
    // keep a working session cookie past that point, so clear both cookies
    // here unconditionally.
    await clearCookies([
      PLATFORM_SESSION_COOKIE_NAME,
      PLATFORM_CSRF_COOKIE_NAME,
    ]);

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
    const contactName = String(formData.get("contactName") ?? "").trim();
    const contactEmail = String(formData.get("contactEmail") ?? "").trim();
    const contactPhone = String(formData.get("contactPhone") ?? "").trim();
    const primaryDomain = String(formData.get("primaryDomain") ?? "").trim();

    if (
      !name ||
      !slug ||
      !SEGMENT_TEMPLATES.includes(segmentTemplate) ||
      !contactName ||
      !contactEmail ||
      !contactPhone
    ) {
      redirect("/platform/tenants?error=1");
    }

    const result = await createPlatformTenant({
      name,
      slug,
      segmentTemplate,
      country: country || undefined,
      timezone: timezone || undefined,
      language: language || undefined,
      contactName,
      contactEmail,
      contactPhone,
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

  async function unarchiveAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();

    if (!tenantId) {
      redirect("/platform/tenants?error=1");
    }

    const result = await unarchivePlatformTenant(tenantId);

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function purgeAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const confirmSlug = String(formData.get("confirmSlug") ?? "").trim();

    if (!tenantId || !confirmSlug) {
      redirect("/platform/tenants?error=1");
    }

    // The backend re-validates the slug echo against the tenant and refuses
    // non-archived tenants; a mismatch is a 4xx and nothing changes.
    const result = await requestPlatformTenantPurge(tenantId, { confirmSlug });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function inviteSuperadminAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const tenantSlug = String(formData.get("tenantSlug") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();

    if (!tenantId || !tenantSlug || !email) {
      redirect("/platform/tenants?error=invite");
    }

    const result = await invitePlatformTenantSuperadmin(tenantId, {
      email,
    });

    if (!result.ok) {
      redirect("/platform/tenants?error=invite");
    }

    const flash: InviteFlash = {
      email: result.data.email,
      tenantSlug,
      token: result.data.token,
    };
    const cookieStore = await cookies();
    cookieStore.set(INVITE_FLASH_COOKIE, JSON.stringify(flash), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/platform/tenants",
      maxAge: INVITE_FLASH_MAX_AGE_SECONDS,
    });

    redirect("/platform/tenants?invited=1");
  }

  async function promoteSuperadminAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const userId = String(formData.get("userId") ?? "").trim();

    if (!tenantId || !userId) {
      redirect("/platform/tenants?error=1");
    }

    const result = await promotePlatformTenantSuperadmin(tenantId, {
      userId,
    });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function updateCountryAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const country = String(formData.get("country") ?? "").trim();

    if (!tenantId || !country) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenant(tenantId, { country });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function updateTimezoneAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const timezone = String(formData.get("timezone") ?? "").trim();

    if (!tenantId || !timezone) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenant(tenantId, { timezone });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function updateLanguageAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const language = String(formData.get("language") ?? "").trim();

    if (!tenantId || !language) {
      redirect("/platform/tenants?error=1");
    }

    const result = await updatePlatformTenant(tenantId, { language });

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function updateContactAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    const field = String(formData.get("field") ?? "").trim();
    const value = String(formData.get("value") ?? "").trim();

    if (!tenantId || !value) {
      redirect("/platform/tenants?error=1");
    }

    let result;
    if (field === "contactName") {
      result = await updatePlatformTenant(tenantId, { contactName: value });
    } else if (field === "contactEmail") {
      result = await updatePlatformTenant(tenantId, { contactEmail: value });
    } else if (field === "contactPhone") {
      result = await updatePlatformTenant(tenantId, { contactPhone: value });
    } else {
      redirect("/platform/tenants?error=1");
    }

    redirect(`/platform/tenants?${result.ok ? "saved=1" : "error=1"}`);
  }

  async function updateAdminLimitAction(formData: FormData) {
    "use server";

    const tenantId = String(formData.get("tenantId") ?? "").trim();
    if (!tenantId) {
      redirect("/platform/tenants?error=1");
    }

    // Checkbox present → clear the override so the cap follows the plan tier;
    // otherwise persist the explicit per-tenant number.
    const followPlan = formData.get("followPlan") !== null;
    let adminLimit: number | null = null;

    if (!followPlan) {
      const parsed = Number(formData.get("adminLimit"));

      if (!Number.isInteger(parsed) || parsed < 1) {
        redirect("/platform/tenants?error=1");
      }

      adminLimit = parsed;
    }

    const result = await updatePlatformTenant(tenantId, { adminLimit });

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
  const inviteFlash = pageState.invited ? await readInviteFlash() : null;
  const inviteLink = inviteFlash
    ? `/${inviteFlash.tenantSlug}/invites/accept?token=${encodeURIComponent(
        inviteFlash.token,
      )}`
    : null;

  function renderTenantCard(tenant: PlatformTenant) {
    const isArchived = tenant.status === "archived";
    const usersResult = tenantUsersByTenantId.find(
      (entry) => entry.tenantId === tenant.id,
    )?.result;
    const users: TenantUser[] = usersResult?.ok ? usersResult.data.items : [];
    const companyAdmins = users.filter((user) =>
      user.roleCodes.includes("company_admin"),
    );
    const metrics = tenant.metrics ?? EMPTY_TENANT_METRICS;
    const superadminSummary: TenantSuperadminSummary | null =
      tenant.superadmin ?? null;
    const activeSuperadmin = superadminSummary?.activeSuperadmin ?? null;
    const superadminLabel = activeSuperadmin
      ? activeSuperadmin.email
      : superadminSummary?.pendingInvite
        ? "Invite pending"
        : "—";

    return (
      <details
        className="tenant-collapse"
        key={tenant.id}
        name="platform-tenant"
      >
        <summary>
          <span className="tenant-collapse-name">{tenant.name}</span>
          <span className="tenant-status-chip">
            {formatLabel(tenant.status)}
          </span>
        </summary>
        <div className="tenant-collapse-body">
          <section
            className="tenant-metrics-block"
            aria-label={`${tenant.name} tenant information`}
          >
            <h3>Tenant information</h3>
            <dl className="tenant-metrics-grid">
              <div>
                <dt>Name</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.name}
                  </span>
                  {isArchived ? null : (
                    <NameChangeForm
                      action={updateNameAction}
                      currentName={tenant.name}
                      tenantId={tenant.id}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Slug</dt>
                <dd>{tenant.slug}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {formatLabel(tenant.status)}
                  </span>
                  {isArchived ? null : (
                    <StatusChangeForm
                      currentStatus={tenant.status}
                      statuses={ASSIGNABLE_STATUSES}
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                      updateAction={updateStatusAction}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatShortDate(format, tenant.createdAt)}</dd>
              </div>
              <div>
                <dt>Country</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.country}
                  </span>
                  {isArchived ? null : (
                    <SingleFieldForm
                      action={updateCountryAction}
                      confirmLabel="Confirm country"
                      currentValue={tenant.country}
                      dialogId="tenant-country-title"
                      eyebrow="Tenant country"
                      fieldLabel="Country"
                      inputName="country"
                      placeholder="UA"
                      tenantId={tenant.id}
                      title="Change country"
                      triggerLabel={`Edit country for ${tenant.name}`}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.timezone}
                  </span>
                  {isArchived ? null : (
                    <TimezoneForm
                      action={updateTimezoneAction}
                      currentTimezone={tenant.timezone}
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Language</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.language}
                  </span>
                  {isArchived ? null : (
                    <LanguageForm
                      action={updateLanguageAction}
                      currentLanguage={tenant.language}
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Contact name</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.contactName ?? "—"}
                  </span>
                  {isArchived ? null : (
                    <SingleFieldForm
                      action={updateContactAction}
                      confirmLabel="Confirm"
                      currentValue={tenant.contactName}
                      dialogId="tenant-contactName-title"
                      eyebrow="Contact details"
                      fieldLabel="Contact name"
                      hiddenFields={{ field: "contactName" }}
                      inputName="value"
                      inputType="text"
                      tenantId={tenant.id}
                      title="Edit contact name"
                      triggerLabel={`Edit contact name for ${tenant.name}`}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Contact email</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.contactEmail ? (
                      <a href={`mailto:${tenant.contactEmail}`}>
                        {tenant.contactEmail}
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                  {isArchived ? null : (
                    <SingleFieldForm
                      action={updateContactAction}
                      confirmLabel="Confirm"
                      currentValue={tenant.contactEmail}
                      dialogId="tenant-contactEmail-title"
                      eyebrow="Contact details"
                      fieldLabel="Contact email"
                      hiddenFields={{ field: "contactEmail" }}
                      inputName="value"
                      inputType="email"
                      tenantId={tenant.id}
                      title="Edit contact email"
                      triggerLabel={`Edit contact email for ${tenant.name}`}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Contact phone</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {tenant.contactPhone ? (
                      <a
                        href={`tel:${tenant.contactPhone.replace(/\s+/g, "")}`}
                      >
                        {tenant.contactPhone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </span>
                  {isArchived ? null : (
                    <SingleFieldForm
                      action={updateContactAction}
                      confirmLabel="Confirm"
                      currentValue={tenant.contactPhone}
                      dialogId="tenant-contactPhone-title"
                      eyebrow="Contact details"
                      fieldLabel="Contact phone"
                      hiddenFields={{ field: "contactPhone" }}
                      inputName="value"
                      inputType="tel"
                      tenantId={tenant.id}
                      title="Edit contact phone"
                      triggerLabel={`Edit contact phone for ${tenant.name}`}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Superadmin</dt>
                <dd className="tenant-admin-metric-value">
                  <span className="tenant-metric-inline-text">
                    {superadminLabel}
                  </span>
                  {isArchived ? null : (
                    <TenantAdminControls
                      activeSuperadmin={activeSuperadmin}
                      admins={companyAdmins}
                      inviteAction={inviteSuperadminAction}
                      pendingSuperadminInvite={Boolean(
                        superadminSummary?.pendingInvite,
                      )}
                      promoteAction={promoteSuperadminAction}
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                      tenantSlug={tenant.slug}
                      usersAvailable={Boolean(usersResult?.ok)}
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>Admins</dt>
                <dd className="tenant-admin-metric-value">
                  <span>
                    {metrics.companyAdminCount} / {tenant.adminLimit}
                  </span>
                  {isArchived ? null : (
                    <AdminLimitForm
                      action={updateAdminLimitAction}
                      currentOverride={tenant.adminLimitOverride}
                      planDefault={tenant.adminLimitPlanDefault}
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                    />
                  )}
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
            <div className="tenant-purge-block">
              <p className="tenant-status-confirmation">
                {describePurgeState(tenant)}
              </p>
              <div className="toolbar">
                {tenant.purgeStartedAt ? null : (
                  <>
                    <ArchiveTenantForm
                      action={unarchiveAction}
                      mode="unarchive"
                      tenantId={tenant.id}
                      tenantName={tenant.name}
                    />
                    {tenant.purgeRequestedAt ? null : (
                      <PurgeTenantForm
                        action={purgeAction}
                        tenantId={tenant.id}
                        tenantName={tenant.name}
                        tenantSlug={tenant.slug}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="toolbar">
              <ArchiveTenantForm
                action={archiveAction}
                mode="archive"
                tenantId={tenant.id}
                tenantName={tenant.name}
              />
            </div>
          )}
        </div>
      </details>
    );
  }

  const activeTenants = tenantsResult.ok
    ? tenantsResult.data.filter((tenant) => tenant.status !== "archived")
    : [];
  const archivedTenants = tenantsResult.ok
    ? tenantsResult.data.filter((tenant) => tenant.status === "archived")
    : [];

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
          <p>Tenant created and ready to use.</p>
        </AutoDismissNotice>
      ) : null}
      {pageState.invited ? (
        <section className="notice-panel success" aria-label="Invite status">
          <div>
            <p className="eyebrow">Invite created</p>
            <h2>Tenant superadmin invite is ready</h2>
            <p>
              The invite was created
              {inviteFlash?.email ? ` for ${inviteFlash.email}` : ""}. Share
              this link through a trusted channel.
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
          <>
            <div className="tenant-collapse-list">
              {activeTenants.map((tenant) => renderTenantCard(tenant))}
            </div>

            {archivedTenants.length ? (
              <details className="tenant-archive-section">
                <summary>Archived ({archivedTenants.length})</summary>
                <div className="tenant-collapse-list">
                  {archivedTenants.map((tenant) => renderTenantCard(tenant))}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <p>{tenantsResult.message}</p>
        )}
      </section>
    </main>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Purge state for an archived tenant, in escalating order: the worker has
// started (irreversible), the owner marked it for early purge (cancellable
// via unarchive), or it is riding out the retention window computed by the
// backend (`purgeEligibleAt` = archivedAt + retention days).
function describePurgeState(tenant: PlatformTenant): string {
  if (tenant.purgeStartedAt) {
    return "Purge in progress — this tenant's data is being permanently deleted and it can no longer be restored.";
  }

  if (tenant.purgeRequestedAt) {
    return "Marked for purge — the background worker will permanently delete this tenant on its next run. Unarchive cancels the request.";
  }

  const eligibleAt = tenant.purgeEligibleAt
    ? new Date(tenant.purgeEligibleAt)
    : null;

  if (!eligibleAt || Number.isNaN(eligibleAt.getTime())) {
    return "Archived. This tenant is only purged after an explicit purge request.";
  }

  const daysRemaining = Math.ceil(
    (eligibleAt.getTime() - Date.now()) / MS_PER_DAY,
  );

  if (daysRemaining > 0) {
    return `Archived. Eligible for permanent deletion in ${daysRemaining} ${
      daysRemaining === 1 ? "day" : "days"
    } (${eligibleAt.toISOString().slice(0, 10)}). Unarchive to keep it.`;
  }

  return "Archived. The retention window has elapsed — the background worker will permanently delete this tenant on its next run. Unarchive to keep it.";
}

async function readInviteFlash(): Promise<InviteFlash | null> {
  const raw = (await cookies()).get(INVITE_FLASH_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InviteFlash>;

    if (
      typeof parsed.email === "string" &&
      typeof parsed.tenantSlug === "string" &&
      typeof parsed.token === "string"
    ) {
      return {
        email: parsed.email,
        tenantSlug: parsed.tenantSlug,
        token: parsed.token,
      };
    }
  } catch {
    // Ignore a malformed or tampered flash cookie and fall back to no link.
  }

  return null;
}
