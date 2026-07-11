import { AppShell } from "../../../../components/app-shell";
import {
  getPilotReviewSummary,
  recordDashboardView,
  type PilotReviewSummary,
  type PilotReviewThreshold,
} from "../../../../lib/api-client";
import { getFormatter, getTranslations } from "next-intl/server";

import { formatDateTime } from "../../../../lib/format";

type AdminReviewPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function AdminReviewPage({
  params,
}: AdminReviewPageProps) {
  const { tenantSlug } = await params;
  const [t, tAdmin, tCommon, format] = await Promise.all([
    getTranslations("admin.review"),
    getTranslations("admin"),
    getTranslations("common"),
    getFormatter(),
  ]);

  await recordDashboardView("admin_review").catch(() => undefined);

  const summaryResult = await getPilotReviewSummary();

  if (!summaryResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
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
            <p>{summaryResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const summary = summaryResult.data;
  const applicableThresholds = summary.thresholds.filter(
    (threshold) => threshold.status !== "na",
  );
  const metThresholds = applicableThresholds.filter(
    (threshold) => threshold.status === "met",
  );
  const readyPercent =
    applicableThresholds.length > 0
      ? Math.round((metThresholds.length / applicableThresholds.length) * 100)
      : 0;
  const copySummary = buildReviewSummary(summary, readyPercent, format, t);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/admin/setup`}>
            {t("setup")}
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager`}>
            {t("managerView")}
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("thresholdsMet")}</p>
            <span
              className={`status-pill ${readyPercent >= 70 ? "active" : "warning"}`}
            >
              {t("review")}
            </span>
          </header>
          <p className="metric-value">{readyPercent}%</p>
          <p className="small-label">
            {t("checksDetail", {
              met: metThresholds.length,
              total: applicableThresholds.length,
            })}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("pilotWindow")}</p>
            <span className="status-pill info">
              {summary.windowStart ? t("started") : t("notStarted")}
            </span>
          </header>
          <p className="metric-value">
            {summary.windowStart ? t("sevenDays") : "-"}
          </p>
          <p className="small-label">
            {summary.windowStart
              ? t("fromDate", {
                  date: formatDateTime(format, summary.windowStart),
                })
              : t("waitingFirstVisit")}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("windowEnds")}</p>
            <span className="status-pill info">{t("window")}</span>
          </header>
          <p className="metric-value">
            {summary.windowEnd
              ? formatDateTime(format, summary.windowEnd)
              : "-"}
          </p>
          <p className="small-label">{t("windowEndsDetail")}</p>
        </article>
      </section>

      <section className="review-grid">
        <div className="panel">
          <h2>{t("successThresholds")}</h2>
          <div className="review-threshold-list">
            {summary.thresholds.map((threshold) => (
              <article className="review-threshold" key={threshold.key}>
                <div>
                  <span
                    className={`setup-status ${thresholdStatusClass(threshold.status)}`}
                  >
                    {formatThresholdStatus(threshold.status, t)}
                  </span>
                  <h3>{threshold.label}</h3>
                  <p>{threshold.target}</p>
                </div>
                <strong>{threshold.result}</strong>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel">
          <h2>{t("copyableSummary")}</h2>
          <textarea
            className="summary-copy-box"
            readOnly
            rows={18}
            value={copySummary}
          />
          <p className="form-hint">{t("copyHint")}</p>
        </aside>
      </section>
    </AppShell>
  );
}

type ReviewTranslator = Awaited<
  ReturnType<typeof getTranslations<"admin.review">>
>;

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
