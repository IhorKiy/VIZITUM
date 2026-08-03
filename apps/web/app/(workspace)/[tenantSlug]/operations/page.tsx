import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  getOperationsSummary,
  type OperationsSummary,
} from "../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../lib/demo-mode";
import { formatDateTime, formatEnumLabel } from "../../../../lib/format";

type OperationsTranslator = Awaited<
  ReturnType<typeof getTranslations<"operations">>
>;

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
      pilot: 1,
      team: 2,
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
  const [t, tCommon, format] = await Promise.all([
    getTranslations("operations"),
    getTranslations("common"),
    getFormatter(),
  ]);
  const summaryResult = await getOperationsSummary();
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!summaryResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="operations">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
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
            <p>{summaryResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const summary = summaryResult.ok ? summaryResult.data : demoSummary;
  const metrics = buildMetrics(summary, t);
  const tenantRows = Object.entries(summary.tenants.byStatus);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="operations">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar">
          <span className="status-pill info">
            {summaryResult.ok ? tCommon("labels.live") : tCommon("labels.demo")}
          </span>
        </div>
      </header>

      {!summaryResult.ok && demoFallbackEnabled ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{t("demoBody", { reason: summaryResult.message })}</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <header>
              <p className="metric-label">{metric.label}</p>
              <span className={`status-pill ${metric.tone}`}>
                {metric.tone === "active"
                  ? tCommon("tone.ok")
                  : tCommon(`tone.${metric.tone}`)}
              </span>
            </header>
            <p className="metric-value">{metric.value}</p>
            <p className="small-label">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" aria-label={t("detailsAria")}>
        <div className="panel">
          <h2>{t("tenantStatus")}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t("tableStatus")}</th>
                <th>{t("tableTenants")}</th>
              </tr>
            </thead>
            <tbody>
              {tenantRows.map(([status, count]) => (
                <tr key={status}>
                  <td>{formatEnumLabel(tCommon, status)}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>{t("cleanupJobs")}</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{t("provisioningQueued")}</th>
                <td>{summary.provisioning.queued}</td>
              </tr>
              <tr>
                <th scope="row">{t("provisioningRunning")}</th>
                <td>{summary.provisioning.running}</td>
              </tr>
              <tr>
                <th scope="row">{t("aiQueue")}</th>
                <td>{summary.ai.queued + summary.ai.running}</td>
              </tr>
              <tr>
                <th scope="row">{t("expiredTempObjects")}</th>
                <td>{summary.storage.expiredTemporaryAwaitingCleanup}</td>
              </tr>
              <tr>
                <th scope="row">{t("generated")}</th>
                <td>{formatDateTime(format, summary.generatedAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function buildMetrics(
  summary: OperationsSummary,
  t: OperationsTranslator,
): OpsMetric[] {
  const importIssues =
    summary.imports.failedRecent + summary.imports.validationFailedRecent;
  const aiBacklog = summary.ai.queued + summary.ai.running;
  const cleanupBacklog =
    summary.ai.expiredFailedAwaitingCleanup +
    summary.storage.expiredTemporaryAwaitingCleanup;

  return [
    {
      label: t("tenants"),
      value: String(summary.tenants.total),
      detail: t("statusesTracked", {
        count: Object.keys(summary.tenants.byStatus).length,
      }),
      tone: "active",
    },
    {
      label: t("importIssues"),
      value: String(importIssues),
      detail: t("pendingConfirmation", {
        count: summary.imports.pendingConfirmation,
      }),
      tone: importIssues > 0 ? "warning" : "active",
    },
    {
      label: t("aiBacklog"),
      value: String(aiBacklog),
      detail: t("failedInWindow", {
        count: summary.ai.failedRecent,
        hours: summary.windowHours,
      }),
      tone: summary.ai.failedRecent > 0 ? "warning" : "info",
    },
    {
      label: t("cleanupBacklog"),
      value: String(cleanupBacklog),
      detail: t("deletedRecently", {
        count: summary.storage.deletedRecent,
      }),
      tone: cleanupBacklog > 0 ? "warning" : "active",
    },
    {
      label: t("provisioningFailures"),
      value: String(summary.provisioning.failedRecent),
      detail: t("activeProvisioningJobs", {
        count: summary.provisioning.queued + summary.provisioning.running,
      }),
      tone: summary.provisioning.failedRecent > 0 ? "warning" : "active",
    },
    {
      label: t("window"),
      value: `${summary.windowHours}h`,
      detail: summary.requestId
        ? t("requestLabel", { id: summary.requestId })
        : t("latestSnapshot"),
      tone: "info",
    },
  ];
}
