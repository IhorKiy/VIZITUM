import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  countActiveProducts,
  getPilotReviewSummary,
  listAdminUsers,
  listImportTemplates,
  listLocations,
  recordDashboardView,
  type ApiResult,
  type ImportTemplateSummary,
  type Location,
  type PaginatedResponse,
  type PilotReviewSummary,
  type PilotReviewThreshold,
  type TenantUser,
} from "../../../../lib/api-client";
import { formatDateTime } from "../../../../lib/format";

type AdminPilotPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type ChecklistItem = {
  title: string;
  detail: string;
  status: "ready" | "needs-work" | "blocked";
};

type SetupTranslator = Awaited<
  ReturnType<typeof getTranslations<"admin.setup">>
>;
type ReviewTranslator = Awaited<
  ReturnType<typeof getTranslations<"admin.review">>
>;

export default async function AdminPilotPage({ params }: AdminPilotPageProps) {
  const { tenantSlug } = await params;
  const [t, tReview, tPilot, tAdmin, tCommon, format] = await Promise.all([
    getTranslations("admin.setup"),
    getTranslations("admin.review"),
    getTranslations("admin.pilot"),
    getTranslations("admin"),
    getTranslations("common"),
    getFormatter(),
  ]);

  await recordDashboardView("admin_review").catch(() => undefined);

  const [
    usersResult,
    locationsResult,
    productsResult,
    templatesResult,
    summaryResult,
  ] = await Promise.all([
    listAdminUsers(),
    listLocations(),
    countActiveProducts(),
    listImportTemplates(),
    getPilotReviewSummary(),
  ]);

  if (
    !usersResult.ok &&
    !locationsResult.ok &&
    !templatesResult.ok &&
    !summaryResult.ok
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-pilot">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{tPilot("title")}</h1>
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
            <h2>{tReview("notConnectedTitle")}</h2>
            <p>{summaryResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const checklist = buildChecklist(
    { usersResult, locationsResult, productsResult, templatesResult },
    t,
  );
  const readyCount = checklist.filter((item) => item.status === "ready").length;
  const blockedCount = checklist.filter(
    (item) => item.status === "blocked",
  ).length;
  const readinessPercent = Math.round((readyCount / checklist.length) * 100);
  const activeUserCount = usersResult.ok
    ? usersResult.data.items.filter((user) => user.status === "active").length
    : null;

  const summary = summaryResult.ok ? summaryResult.data : null;
  const summaryError = summaryResult.ok ? null : summaryResult.message;
  const applicableThresholds =
    summary?.thresholds.filter((threshold) => threshold.status !== "na") ?? [];
  const metThresholds = applicableThresholds.filter(
    (threshold) => threshold.status === "met",
  );
  const readyPercent =
    applicableThresholds.length > 0
      ? Math.round((metThresholds.length / applicableThresholds.length) * 100)
      : 0;
  const copySummary = summary
    ? buildReviewSummary(summary, readyPercent, format, tReview)
    : "";

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-pilot">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{tPilot("title")}</h1>
        </div>
        <div className="toolbar">
          <a className="primary-button" href={`/${tenantSlug}/manager`}>
            {tReview("managerView")}
          </a>
        </div>
      </header>

      <section className="admin-accordion-stack">
        <details className="panel panel-collapsible" open>
          <summary className="panel-summary">
            <h2>{t("pilotSettings")}</h2>
          </summary>
          <div className="pilot-metrics" aria-label={t("metricsAria")}>
            <div className="setup-metric">
              <span className="setup-metric-value">{readinessPercent}%</span>
              <span className="setup-metric-label">
                {t("checksReady", {
                  ready: readyCount,
                  total: checklist.length,
                })}
              </span>
            </div>
            <div className="setup-metric">
              <span className="setup-metric-value">
                {activeUserCount ?? "-"}
              </span>
              <span className="setup-metric-label">{t("activeUsers")}</span>
            </div>
            <div className="setup-metric">
              <span className="setup-metric-value">
                {checklist.length - readyCount}
              </span>
              <span className="setup-metric-label">
                {blockedCount > 0 ? t("openSetupItems") : t("itemsLeft")}
              </span>
            </div>
          </div>
          <div className="setup-subsection">
            <h3>{t("setupProgress")}</h3>
            <div className="setup-card-grid">
              {checklist.map((item) => (
                <article className="metric-card setup-card" key={item.title}>
                  <header>
                    <h3 className="setup-card-title">{item.title}</h3>
                    <span className={`status-pill ${statusTone(item.status)}`}>
                      {formatStatus(item.status, t)}
                    </span>
                  </header>
                  <p className="small-label">{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
          <div className="pilot-handoff field-stack">
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
        </details>

        <details className="panel panel-collapsible" open>
          <summary className="panel-summary">
            <h2>{tReview("title")}</h2>
          </summary>
          {summary ? (
            <>
              <div
                className="pilot-metrics"
                aria-label={tReview("metricsAria")}
              >
                <div className="setup-metric">
                  <span className="setup-metric-value">{readyPercent}%</span>
                  <span className="setup-metric-label">
                    {tReview("checksDetail", {
                      met: metThresholds.length,
                      total: applicableThresholds.length,
                    })}
                  </span>
                </div>
                <div className="setup-metric">
                  <span className="setup-metric-value">
                    {summary.windowStart ? tReview("sevenDays") : "-"}
                  </span>
                  <span className="setup-metric-label">
                    {tReview("pilotWindow")}
                  </span>
                </div>
                <div className="setup-metric">
                  <span className="setup-metric-value">
                    {summary.windowEnd
                      ? formatDateTime(format, summary.windowEnd)
                      : "-"}
                  </span>
                  <span className="setup-metric-label">
                    {tReview("windowEnds")}
                  </span>
                </div>
              </div>

              <div className="setup-subsection">
                <h3>{tReview("successThresholds")}</h3>
                <div className="review-threshold-list">
                  {summary.thresholds.map((threshold) => (
                    <article className="review-threshold" key={threshold.key}>
                      <div>
                        <span
                          className={`setup-status ${thresholdStatusClass(
                            threshold.status,
                          )}`}
                        >
                          {formatThresholdStatus(threshold.status, tReview)}
                        </span>
                        <h3>{threshold.label}</h3>
                        <p>{threshold.target}</p>
                      </div>
                      <strong>{threshold.result}</strong>
                    </article>
                  ))}
                </div>
              </div>

              <div className="setup-subsection">
                <h3>{tReview("copyableSummary")}</h3>
                <textarea
                  className="summary-copy-box"
                  readOnly
                  rows={18}
                  value={copySummary}
                />
                <p className="form-hint">{tReview("copyHint")}</p>
              </div>
            </>
          ) : (
            <p className="empty-state">{summaryError}</p>
          )}
        </details>
      </section>
    </AppShell>
  );
}

function buildChecklist(
  {
    usersResult,
    locationsResult,
    productsResult,
    templatesResult,
  }: {
    usersResult: ApiResult<PaginatedResponse<TenantUser>>;
    locationsResult: ApiResult<PaginatedResponse<Location>>;
    productsResult: ApiResult<number>;
    templatesResult: ApiResult<ImportTemplateSummary[]>;
  },
  t: SetupTranslator,
): ChecklistItem[] {
  const users = usersResult.ok ? usersResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
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
  const activeProductCount = productsResult.ok ? productsResult.data : 0;
  const initialPlanTemplateReady = templates.some(
    (template) => template.type === "initial_visit_task_plan",
  );

  return [
    {
      title: t("adminAccessTitle"),
      detail: hasAdmin ? t("adminAccessReady") : t("adminAccessNeedsWork"),
      status: usersResult.ok && hasAdmin ? "ready" : "needs-work",
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
    },
    {
      title: t("locationsTitle"),
      detail:
        activeLocationCount > 0
          ? t("locationsReady", { count: activeLocationCount })
          : t("locationsNeedsWork"),
      status:
        locationsResult.ok && activeLocationCount > 0 ? "ready" : "needs-work",
    },
    {
      title: t("productsTitle"),
      detail:
        activeProductCount > 0
          ? t("productsReady", { count: activeProductCount })
          : t("productsNeedsWork"),
      status:
        productsResult.ok && activeProductCount > 0 ? "ready" : "needs-work",
    },
    {
      title: t("planTitle"),
      detail: initialPlanTemplateReady ? t("planReady") : t("planBlocked"),
      status:
        templatesResult.ok && initialPlanTemplateReady ? "ready" : "blocked",
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

function statusTone(status: ChecklistItem["status"]): string {
  switch (status) {
    case "ready":
      return "active";
    case "needs-work":
      return "warning";
    case "blocked":
      return "danger";
  }
}

function buildReviewSummary(
  summary: PilotReviewSummary,
  readyPercent: number,
  format: Awaited<ReturnType<typeof getFormatter>>,
  t: ReviewTranslator,
): string {
  const lines = [
    t("summaryTitle"),
    "",
    t("summaryReadiness", { percent: readyPercent }),
    summary.windowStart
      ? t("summaryWindow", {
          start: formatDateTime(format, summary.windowStart),
          end: formatDateTime(format, summary.windowEnd),
        })
      : t("summaryWindowNotStarted"),
    "",
    t("summaryThresholds"),
    ...summary.thresholds.map(
      (threshold) =>
        `- ${threshold.label}: ${formatThresholdStatus(threshold.status, t)} (${threshold.result})`,
    ),
    "",
    t("summaryNotes"),
    t("summaryNotesLine"),
  ];

  return lines.join("\n");
}

function formatThresholdStatus(
  status: PilotReviewThreshold["status"],
  t: ReviewTranslator,
): string {
  switch (status) {
    case "met":
      return t("statusMet");
    case "not_met":
      return t("statusNotMet");
    case "na":
      return t("statusNa");
  }
}

function thresholdStatusClass(status: PilotReviewThreshold["status"]): string {
  return status === "not_met" ? "not-met" : status;
}
