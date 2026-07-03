import { AppShell } from "../../../../components/app-shell";
import {
  listAdminUsers,
  listImportTemplates,
  listLocations,
  listProducts,
  type ApiResult,
  type ImportTemplateSummary,
  type Location,
  type PaginatedResponse,
  type Product,
  type TenantUser,
} from "../../../../lib/api-client";

type AdminSetupPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type ChecklistItem = {
  title: string;
  detail: string;
  status: "ready" | "needs-work" | "blocked";
  actionLabel: string;
  href: string;
};

export default async function AdminSetupPage({ params }: AdminSetupPageProps) {
  const { tenantSlug } = await params;
  const [usersResult, locationsResult, productsResult, templatesResult] =
    await Promise.all([
      listAdminUsers(),
      listLocations(),
      listProducts(),
      listImportTemplates(),
    ]);

  if (!usersResult.ok && !locationsResult.ok && !templatesResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-setup">
        <header className="page-header">
          <div>
            <p className="eyebrow">Company admin</p>
            <h1>Onboarding checklist</h1>
            <p>
              Live tenant setup data is required in production before pilot
              readiness can be reviewed.
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
            <h2>Setup data is not connected</h2>
            <p>{usersResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const checklist = buildChecklist({
    tenantSlug,
    usersResult,
    locationsResult,
    productsResult,
    templatesResult,
  });
  const readyCount = checklist.filter((item) => item.status === "ready").length;
  const blockedCount = checklist.filter(
    (item) => item.status === "blocked",
  ).length;
  const readinessPercent = Math.round((readyCount / checklist.length) * 100);
  const pilotReady = readyCount === checklist.length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-setup">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Onboarding checklist</h1>
          <p>
            Review tenant setup progress before inviting the team into active
            pilot work.
          </p>
        </div>
        <div className="toolbar">
          <span className={`status-pill ${pilotReady ? "active" : "warning"}`}>
            {pilotReady ? "Pilot-ready" : "Setup needed"}
          </span>
        </div>
      </header>

      <section className="manager-grid" aria-label="Setup metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Readiness</p>
            <span className="status-pill info">Checklist</span>
          </header>
          <p className="metric-value">{readinessPercent}%</p>
          <p className="small-label">
            {readyCount} of {checklist.length} checks ready
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Active users</p>
            <span className="status-pill active">Live</span>
          </header>
          <p className="metric-value">
            {usersResult.ok
              ? usersResult.data.items.filter(
                  (user) => user.status === "active",
                ).length
              : "-"}
          </p>
          <p className="small-label">
            {usersResult.ok
              ? `${usersResult.data.total} total tenant users`
              : usersResult.message}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Open setup items</p>
            <span
              className={`status-pill ${blockedCount > 0 ? "warning" : "active"}`}
            >
              {blockedCount > 0 ? "Review" : "OK"}
            </span>
          </header>
          <p className="metric-value">{checklist.length - readyCount}</p>
          <p className="small-label">Items left before pilot review</p>
        </article>
      </section>

      <section className="setup-grid">
        <div className="panel">
          <h2>Setup progress</h2>
          <div className="setup-checklist">
            {checklist.map((item) => (
              <article className="setup-check" key={item.title}>
                <div>
                  <span className={`setup-status ${item.status}`}>
                    {formatStatus(item.status)}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
                <a className="secondary-button" href={item.href}>
                  {item.actionLabel}
                </a>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel">
          <h2>Pilot handoff</h2>
          <div className="field-stack">
            <div className="setup-summary-block">
              <p className="eyebrow">Before activation</p>
              <p>
                Users, locations, product applicability and initial route/task
                plan should be ready before switching the tenant into real pilot
                operation.
              </p>
            </div>
            <div className="setup-summary-block">
              <p className="eyebrow">Recording notice</p>
              <p>
                Field users see the first-recording notice in the Field flow.
                Keep the company-level AI processing addendum attached during
                pilot onboarding.
              </p>
            </div>
            <div className="setup-summary-block">
              <p className="eyebrow">Next role screen</p>
              <p>
                After this checklist, the next P0 screen is Manager visits and
                tasks drilldown.
              </p>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}

function buildChecklist({
  tenantSlug,
  usersResult,
  locationsResult,
  productsResult,
  templatesResult,
}: {
  tenantSlug: string;
  usersResult: ApiResult<PaginatedResponse<TenantUser>>;
  locationsResult: ApiResult<PaginatedResponse<Location>>;
  productsResult: ApiResult<PaginatedResponse<Product>>;
  templatesResult: ApiResult<ImportTemplateSummary[]>;
}): ChecklistItem[] {
  const users = usersResult.ok ? usersResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const products = productsResult.ok ? productsResult.data.items : [];
  const templates = templatesResult.ok ? templatesResult.data : [];
  const hasAdmin = users.some((user) =>
    user.roleCodes.includes("company_admin"),
  );
  const hasManager = users.some((user) =>
    user.roleCodes.includes("team_manager"),
  );
  const fieldRepCount = users.filter((user) =>
    user.roleCodes.includes("field_representative"),
  ).length;
  const activeLocationCount = locations.filter(
    (location) => location.status === "active",
  ).length;
  const activeProductCount = products.filter(
    (product) => product.status === "active" && !product.notApplicable,
  ).length;
  const productNotApplicable = products.some(
    (product) => product.notApplicable,
  );
  const initialPlanTemplateReady = templates.some(
    (template) => template.type === "initial_visit_task_plan",
  );

  return [
    {
      title: "Company admin access",
      detail: hasAdmin
        ? "At least one Company Admin can manage tenant setup."
        : "Invite or assign a Company Admin before pilot activation.",
      status: usersResult.ok && hasAdmin ? "ready" : "needs-work",
      actionLabel: "Manage users",
      href: `/${tenantSlug}/admin/users`,
    },
    {
      title: "Manager and field roles",
      detail:
        hasManager && fieldRepCount > 0
          ? `${fieldRepCount} field representative role(s) and a Team Manager are configured.`
          : "Add at least one Team Manager and one Field Representative.",
      status:
        usersResult.ok && hasManager && fieldRepCount > 0
          ? "ready"
          : "needs-work",
      actionLabel: "Assign roles",
      href: `/${tenantSlug}/admin/users`,
    },
    {
      title: "Locations",
      detail:
        activeLocationCount > 0
          ? `${activeLocationCount} active location(s) are available for visits.`
          : "Import or create active locations before field work starts.",
      status:
        locationsResult.ok && activeLocationCount > 0 ? "ready" : "needs-work",
      actionLabel: "Open imports",
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: "Products/SKUs",
      detail:
        activeProductCount > 0 || productNotApplicable
          ? activeProductCount > 0
            ? `${activeProductCount} active product/SKU record(s) are available.`
            : "Products/SKUs are marked not applicable for this tenant."
          : "Import products/SKUs or mark them not applicable for the pilot.",
      status:
        productsResult.ok && (activeProductCount > 0 || productNotApplicable)
          ? "ready"
          : "needs-work",
      actionLabel: "Review imports",
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: "Initial route/task plan",
      detail: initialPlanTemplateReady
        ? "Initial visit/task plan template is available for upload."
        : "Initial plan template is unavailable; check import templates.",
      status:
        templatesResult.ok && initialPlanTemplateReady ? "ready" : "blocked",
      actionLabel: "Upload plan",
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: "Pilot review baseline",
      detail:
        hasManager && fieldRepCount > 0 && activeLocationCount > 0
          ? "Core data is ready to generate pilot usage metrics after field work."
          : "Manager, field and location data are required before pilot review can be meaningful.",
      status:
        usersResult.ok &&
        locationsResult.ok &&
        hasManager &&
        fieldRepCount > 0 &&
        activeLocationCount > 0
          ? "ready"
          : "needs-work",
      actionLabel: "View manager",
      href: `/${tenantSlug}/manager`,
    },
  ];
}

function formatStatus(status: ChecklistItem["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs-work":
      return "Needs work";
    case "blocked":
      return "Blocked";
  }
}
