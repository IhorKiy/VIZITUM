import { AppShell } from "../../../components/app-shell";
import {
  getOperationsSummary,
  type OperationsSummary,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

type OperationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type OpsMetric = {
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
};

const demoSummary: OperationsSummary = {
  generatedAt: "2026-06-30T12:00:00.000Z",
  windowHours: 24,
  tenants: {
    total: 3,
    byStatus: {
      pilot_active: 1,
      active: 2,
    },
  },
  provisioning: {
    queued: 0,
    running: 0,
    failedRecent: 0,
  },
  imports: {
    failedRecent: 1,
    validationFailedRecent: 2,
    pendingConfirmation: 3,
  },
  ai: {
    queued: 4,
    running: 1,
    failedRecent: 0,
    expiredFailedAwaitingCleanup: 0,
  },
  storage: {
    expiredTemporaryAwaitingCleanup: 2,
    deletedRecent: 11,
  },
};

export default async function OperationsPage({ params }: OperationsPageProps) {
  const { tenantSlug } = await params;
  const summaryResult = await getOperationsSummary();
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!summaryResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="operations">
        <header className="page-header">
          <div>
            <p className="eyebrow">Platform operations</p>
            <h1>Production readiness</h1>
            <p>
              Live operational counters are required in production before pilot
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
            <h2>Operations summary is not connected</h2>
            <p>{summaryResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const summary = summaryResult.ok ? summaryResult.data : demoSummary;
  const metrics = buildMetrics(summary);
  const tenantRows = Object.entries(summary.tenants.byStatus);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="operations">
      <header className="page-header">
        <div>
          <p className="eyebrow">Platform operations</p>
          <h1>Production readiness</h1>
          <p>
            Monitor tenant status, job backlogs, import failures, AI processing
            and temporary storage cleanup from aggregate operational counters.
          </p>
        </div>
        <div className="toolbar">
          <span className="status-pill info">
            {summaryResult.ok ? "Live" : "Demo"}
          </span>
        </div>
      </header>

      {!summaryResult.ok && demoFallbackEnabled ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Operations summary is not connected</h2>
            <p>
              Showing sample operations counters until the API returns an
              authenticated platform operations response. Reason:{" "}
              {summaryResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Operations metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <header>
              <p className="metric-label">{metric.label}</p>
              <span className={`status-pill ${metric.tone}`}>
                {metric.tone === "active" ? "OK" : metric.tone}
              </span>
            </header>
            <p className="metric-value">{metric.value}</p>
            <p className="small-label">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" aria-label="Operations details">
        <div className="panel">
          <h2>Tenant status</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Tenants</th>
              </tr>
            </thead>
            <tbody>
              {tenantRows.map(([status, count]) => (
                <tr key={status}>
                  <td>{formatLabel(status)}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Cleanup and jobs</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Provisioning queued</th>
                <td>{summary.provisioning.queued}</td>
              </tr>
              <tr>
                <th scope="row">Provisioning running</th>
                <td>{summary.provisioning.running}</td>
              </tr>
              <tr>
                <th scope="row">AI queue</th>
                <td>{summary.ai.queued + summary.ai.running}</td>
              </tr>
              <tr>
                <th scope="row">Expired temp objects</th>
                <td>{summary.storage.expiredTemporaryAwaitingCleanup}</td>
              </tr>
              <tr>
                <th scope="row">Generated</th>
                <td>{formatDateTime(summary.generatedAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function buildMetrics(summary: OperationsSummary): OpsMetric[] {
  const importIssues =
    summary.imports.failedRecent + summary.imports.validationFailedRecent;
  const aiBacklog = summary.ai.queued + summary.ai.running;
  const cleanupBacklog =
    summary.ai.expiredFailedAwaitingCleanup +
    summary.storage.expiredTemporaryAwaitingCleanup;

  return [
    {
      label: "Tenants",
      value: String(summary.tenants.total),
      detail: `${Object.keys(summary.tenants.byStatus).length} statuses tracked`,
      tone: "active",
    },
    {
      label: "Import issues",
      value: String(importIssues),
      detail: `${summary.imports.pendingConfirmation} pending confirmation`,
      tone: importIssues > 0 ? "warning" : "active",
    },
    {
      label: "AI backlog",
      value: String(aiBacklog),
      detail: `${summary.ai.failedRecent} failed in ${summary.windowHours}h`,
      tone: summary.ai.failedRecent > 0 ? "warning" : "info",
    },
    {
      label: "Cleanup backlog",
      value: String(cleanupBacklog),
      detail: `${summary.storage.deletedRecent} temporary objects deleted recently`,
      tone: cleanupBacklog > 0 ? "warning" : "active",
    },
    {
      label: "Provisioning failures",
      value: String(summary.provisioning.failedRecent),
      detail: `${summary.provisioning.queued + summary.provisioning.running} active provisioning jobs`,
      tone: summary.provisioning.failedRecent > 0 ? "warning" : "active",
    },
    {
      label: "Window",
      value: `${summary.windowHours}h`,
      detail: summary.requestId
        ? `Request ${summary.requestId}`
        : "Latest API snapshot",
      tone: "info",
    },
  ];
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
