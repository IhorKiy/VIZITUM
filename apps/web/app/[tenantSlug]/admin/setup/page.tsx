import { getTranslations } from "next-intl/server";

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

type SetupTranslator = Awaited<
  ReturnType<typeof getTranslations<"admin.setup">>
>;

export default async function AdminSetupPage({ params }: AdminSetupPageProps) {
  const { tenantSlug } = await params;
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.setup"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);
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
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
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
            <p>{usersResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const checklist = buildChecklist(
    {
      tenantSlug,
      usersResult,
      locationsResult,
      productsResult,
      templatesResult,
    },
    t,
  );
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
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar">
          <span className={`status-pill ${pilotReady ? "active" : "warning"}`}>
            {pilotReady ? t("pilotReady") : t("setupNeeded")}
          </span>
        </div>
      </header>

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("readiness")}</p>
            <span className="status-pill info">{t("checklist")}</span>
          </header>
          <p className="metric-value">{readinessPercent}%</p>
          <p className="small-label">
            {t("checksReady", { ready: readyCount, total: checklist.length })}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("activeUsers")}</p>
            <span className="status-pill active">
              {tCommon("labels.live")}
            </span>
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
              ? t("totalUsers", { count: usersResult.data.total })
              : usersResult.message}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("openSetupItems")}</p>
            <span
              className={`status-pill ${blockedCount > 0 ? "warning" : "active"}`}
            >
              {blockedCount > 0 ? tCommon("tone.warning") : tCommon("tone.ok")}
            </span>
          </header>
          <p className="metric-value">{checklist.length - readyCount}</p>
          <p className="small-label">{t("itemsLeft")}</p>
        </article>
      </section>

      <section className="setup-grid">
        <div className="panel">
          <h2>{t("setupProgress")}</h2>
          <div className="setup-checklist">
            {checklist.map((item) => (
              <article className="setup-check" key={item.title}>
                <div>
                  <span className={`setup-status ${item.status}`}>
                    {formatStatus(item.status, t)}
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
          <h2>{t("pilotHandoff")}</h2>
          <div className="field-stack">
            <div className="setup-summary-block">
              <p className="eyebrow">{t("beforeActivationEyebrow")}</p>
              <p>{t("beforeActivationBody")}</p>
            </div>
            <div className="setup-summary-block">
              <p className="eyebrow">{t("recordingNoticeEyebrow")}</p>
              <p>{t("recordingNoticeBody")}</p>
            </div>
            <div className="setup-summary-block">
              <p className="eyebrow">{t("nextRoleScreenEyebrow")}</p>
              <p>{t("nextRoleScreenBody")}</p>
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}

function buildChecklist(
  {
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
  },
  t: SetupTranslator,
): ChecklistItem[] {
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
      title: t("adminAccessTitle"),
      detail: hasAdmin ? t("adminAccessReady") : t("adminAccessNeedsWork"),
      status: usersResult.ok && hasAdmin ? "ready" : "needs-work",
      actionLabel: t("manageUsers"),
      href: `/${tenantSlug}/admin/users`,
    },
    {
      title: t("rolesTitle"),
      detail:
        hasManager && fieldRepCount > 0
          ? t("rolesReady", { count: fieldRepCount })
          : t("rolesNeedsWork"),
      status:
        usersResult.ok && hasManager && fieldRepCount > 0
          ? "ready"
          : "needs-work",
      actionLabel: t("assignRoles"),
      href: `/${tenantSlug}/admin/users`,
    },
    {
      title: t("locationsTitle"),
      detail:
        activeLocationCount > 0
          ? t("locationsReady", { count: activeLocationCount })
          : t("locationsNeedsWork"),
      status:
        locationsResult.ok && activeLocationCount > 0 ? "ready" : "needs-work",
      actionLabel: t("openImports"),
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: t("productsTitle"),
      detail:
        activeProductCount > 0 || productNotApplicable
          ? activeProductCount > 0
            ? t("productsReady", { count: activeProductCount })
            : t("productsNotApplicable")
          : t("productsNeedsWork"),
      status:
        productsResult.ok && (activeProductCount > 0 || productNotApplicable)
          ? "ready"
          : "needs-work",
      actionLabel: t("reviewImports"),
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: t("planTitle"),
      detail: initialPlanTemplateReady ? t("planReady") : t("planBlocked"),
      status:
        templatesResult.ok && initialPlanTemplateReady ? "ready" : "blocked",
      actionLabel: t("uploadPlan"),
      href: `/${tenantSlug}/admin/imports`,
    },
    {
      title: t("baselineTitle"),
      detail:
        hasManager && fieldRepCount > 0 && activeLocationCount > 0
          ? t("baselineReady")
          : t("baselineNeedsWork"),
      status:
        usersResult.ok &&
        locationsResult.ok &&
        hasManager &&
        fieldRepCount > 0 &&
        activeLocationCount > 0
          ? "ready"
          : "needs-work",
      actionLabel: t("viewManager"),
      href: `/${tenantSlug}/manager`,
    },
  ];
}

function formatStatus(
  status: ChecklistItem["status"],
  t: SetupTranslator,
): string {
  switch (status) {
    case "ready":
      return t("statusReady");
    case "needs-work":
      return t("statusNeedsWork");
    case "blocked":
      return t("statusBlocked");
  }
}
