import { AppShell } from "../../../../components/app-shell";
import {
  getPilotReviewSummary,
  recordDashboardView,
  type PilotReviewSummary,
  type PilotReviewThreshold,
} from "../../../../lib/api-client";
import { formatDateTime } from "../../../../lib/format";

type AdminReviewPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function AdminReviewPage({
  params,
}: AdminReviewPageProps) {
  const { tenantSlug } = await params;

  await recordDashboardView("admin_review").catch(() => undefined);

  const summaryResult = await getPilotReviewSummary();

  if (!summaryResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
        <header className="page-header">
          <div>
            <p className="eyebrow">Company admin</p>
            <h1>Pilot review</h1>
            <p>
              Live tenant usage data is required before pilot review can be
              generated.
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
            <h2>Pilot review data is not connected</h2>
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
  const copySummary = buildReviewSummary(summary, readyPercent);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Pilot review</h1>
          <p>
            Success thresholds are measured over the 7-day pilot window that
            starts at the first field visit.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/admin/setup`}>
            Setup
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager`}>
            Manager view
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Pilot review metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Thresholds met</p>
            <span
              className={`status-pill ${readyPercent >= 70 ? "active" : "warning"}`}
            >
              Review
            </span>
          </header>
          <p className="metric-value">{readyPercent}%</p>
          <p className="small-label">
            {metThresholds.length} of {applicableThresholds.length} applicable
            checks
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Pilot window</p>
            <span className="status-pill info">
              {summary.windowStart ? "Started" : "Not started"}
            </span>
          </header>
          <p className="metric-value">{summary.windowStart ? "7 days" : "-"}</p>
          <p className="small-label">
            {summary.windowStart
              ? `From ${formatDateTime(summary.windowStart)}`
              : "Waiting for the first field visit"}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Window ends</p>
            <span className="status-pill info">Window</span>
          </header>
          <p className="metric-value">
            {summary.windowEnd ? formatDateTime(summary.windowEnd) : "-"}
          </p>
          <p className="small-label">Seven calendar days from first visit</p>
        </article>
      </section>

      <section className="review-grid">
        <div className="panel">
          <h2>Success thresholds</h2>
          <div className="review-threshold-list">
            {summary.thresholds.map((threshold) => (
              <article className="review-threshold" key={threshold.key}>
                <div>
                  <span
                    className={`setup-status ${thresholdStatusClass(threshold.status)}`}
                  >
                    {formatThresholdStatus(threshold.status)}
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
          <h2>Copyable summary</h2>
          <textarea
            className="summary-copy-box"
            readOnly
            rows={18}
            value={copySummary}
          />
          <p className="form-hint">
            Select and copy this text into the pilot review note or customer
            follow-up.
          </p>
        </aside>
      </section>
    </AppShell>
  );
}

function buildReviewSummary(
  summary: PilotReviewSummary,
  readyPercent: number,
): string {
  const lines = [
    "Vizitum pilot review summary",
    "",
    `Threshold readiness: ${readyPercent}%`,
    summary.windowStart
      ? `Pilot window: ${formatDateTime(summary.windowStart)} - ${formatDateTime(summary.windowEnd)}`
      : "Pilot window: not started (no visits recorded yet)",
    "",
    "Thresholds:",
    ...summary.thresholds.map(
      (threshold) =>
        `- ${threshold.label}: ${formatThresholdStatus(threshold.status)} (${threshold.result})`,
    ),
    "",
    "Notes:",
    "- Use this summary as a starting point for the 7-10 day pilot conversation.",
  ];

  return lines.join("\n");
}

function formatThresholdStatus(status: PilotReviewThreshold["status"]): string {
  switch (status) {
    case "met":
      return "Met";
    case "not_met":
      return "Not met";
    case "na":
      return "N/A";
  }
}

function thresholdStatusClass(status: PilotReviewThreshold["status"]): string {
  return status === "not_met" ? "not-met" : status;
}
