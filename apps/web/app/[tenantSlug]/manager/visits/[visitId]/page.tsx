import { AppShell } from "../../../../../components/app-shell";
import {
  getVisit,
  getVisitReport,
  type Report,
  type Visit,
} from "../../../../../lib/api-client";
import {
  formatDateTime,
  formatLabel,
  formatLabelOrDash,
} from "../../../../../lib/format";

type ManagerVisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
};

export default async function ManagerVisitDetailPage({
  params,
}: ManagerVisitDetailPageProps) {
  const { tenantSlug, visitId } = await params;
  const [visitResult, reportResult] = await Promise.all([
    getVisit(visitId),
    getVisitReport(visitId),
  ]);

  if (!visitResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Visit report</h1>
            <p>
              Live visit data is required before report review can continue.
            </p>
          </div>
          <div className="toolbar">
            <a
              className="primary-button"
              href={`/${tenantSlug}/manager/visits`}
            >
              Back to visits
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="Visit status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Visit is not available</h2>
            <p>{visitResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visit = visitResult.data;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Visit report</h1>
          <p>
            Review confirmed report detail for {visit.location.name} and the
            field representative who completed the visit.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager/tasks`}>
            Tasks
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/visits`}>
            Back to visits
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Visit report metadata">
        {buildVisitMetrics(
          visit,
          reportResult.ok ? reportResult.data : null,
        ).map((metric) => (
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

      <section className="dashboard-grid" aria-label="Visit report detail">
        <article className="panel">
          <div className="panel-title-stack">
            <h2>Visit</h2>
            <p>Operational context for the confirmed report.</p>
          </div>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Location</th>
                <td>
                  {visit.location.name}, {visit.location.city}
                </td>
              </tr>
              <tr>
                <th scope="row">Representative</th>
                <td>{visit.representative.name}</td>
              </tr>
              <tr>
                <th scope="row">Visit type</th>
                <td>{formatLabel(visit.visitType)}</td>
              </tr>
              <tr>
                <th scope="row">Status</th>
                <td>{formatLabel(visit.status)}</td>
              </tr>
              <tr>
                <th scope="row">Started</th>
                <td>{formatDateTime(visit.startedAt)}</td>
              </tr>
              <tr>
                <th scope="row">Completed</th>
                <td>{formatDateTime(visit.completedAt)}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article className="panel">
          {reportResult.ok ? (
            <ReportDetail report={reportResult.data} />
          ) : (
            <div className="empty-state-panel">
              <h2>No confirmed report yet</h2>
              <p>
                {reportResult.message}. The Field Representative can still
                confirm a manual report from the field workspace.
              </p>
              <a
                className="primary-button"
                href={`/${tenantSlug}/manager/visits`}
              >
                Back to visits
              </a>
            </div>
          )}
        </article>
      </section>
    </AppShell>
  );
}

function ReportDetail({ report }: { report: Report }) {
  const data = normalizeReportData(report.confirmedData);

  return (
    <>
      <div className="panel-title-stack">
        <h2>Confirmed report</h2>
        <p>
          Template {formatLabel(report.templateCode)} · confirmed{" "}
          {formatDateTime(report.confirmedAt)}
        </p>
      </div>
      <div className="report-detail-list">
        <TextReportSection title="Summary" value={data.summary} />
        <TextReportSection title="Result status" value={data.resultStatus} />
        <ListReportSection title="Agreements" value={data.agreements} />
        <ListReportSection title="Objections" value={data.objections} />
        <MentionedProductsSection
          title="Mentioned products"
          value={data.mentionedProducts}
        />
        <ListReportSection title="Next actions" value={data.nextActions} />
        <CreatedTasksSection
          title="Created tasks"
          tasks={report.createdTasks}
        />
        <TasksToCreateSection
          title="Draft tasks (as confirmed)"
          value={data.tasksToCreate}
        />
        <LocationUpdatesSection
          title="Location updates"
          value={data.locationUpdates}
        />
        <KeyValueReportSection
          title="Template-specific detail"
          value={data.templateSpecific}
        />
      </div>
    </>
  );
}

function TextReportSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      <p>{formatScalarValue(value)}</p>
    </section>
  );
}

function ListReportSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const items = normalizeList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul className="report-detail-items">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{formatScalarValue(item)}</li>
          ))}
        </ul>
      ) : (
        <p>-</p>
      )}
    </section>
  );
}

function MentionedProductsSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const products = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {products.length > 0 ? (
        <div className="report-detail-cards">
          {products.map((product, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatScalarValue(product.name)}</strong>
              <span>{formatLabelOrDash(product.status)}</span>
              <p>{formatScalarValue(product.evidence)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p>-</p>
      )}
    </section>
  );
}

function CreatedTasksSection({
  title,
  tasks,
}: {
  title: string;
  tasks: Report["createdTasks"];
}) {
  return (
    <section className="report-detail-section">
      <h3>
        {title} ({tasks.length})
      </h3>
      {tasks.length > 0 ? (
        <div className="report-detail-cards">
          {tasks.map((task) => (
            <article className="report-detail-card" key={task.id}>
              <strong>{task.title}</strong>
              <span>
                {formatLabel(task.status)} · {formatLabel(task.priority)}
                {task.dueDate ? ` · due ${task.dueDate}` : ""}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p>No tasks were created from this report.</p>
      )}
    </section>
  );
}

function TasksToCreateSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const tasks = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {tasks.length > 0 ? (
        <div className="report-detail-cards">
          {tasks.map((task, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatScalarValue(task.title)}</strong>
              <span>
                {formatLabelOrDash(task.priority)} ·{" "}
                {formatLabelOrDash(task.assignee)} · due{" "}
                {formatScalarValue(task.dueDate)}
              </span>
              <p>{formatScalarValue(task.description)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p>-</p>
      )}
    </section>
  );
}

function LocationUpdatesSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const updates = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {updates.length > 0 ? (
        <div className="report-detail-cards">
          {updates.map((update, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatLabelOrDash(update.field)}</strong>
              <span>{formatScalarValue(update.proposedValue)}</span>
              <p>{formatScalarValue(update.reason)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p>-</p>
      )}
    </section>
  );
}

function KeyValueReportSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const entries = Object.entries(normalizeReportData(value));

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {entries.length > 0 ? (
        <dl className="report-detail-kv">
          {entries.map(([key, item]) => (
            <div key={key}>
              <dt>{formatLabel(key)}</dt>
              <dd>{formatNestedValue(item)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>-</p>
      )}
    </section>
  );
}

function buildVisitMetrics(
  visit: Visit,
  report: Report | null,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const quality = resolveReportQuality(report);

  return [
    {
      label: "Visit status",
      value: formatLabel(visit.status),
      detail: visit.location.name,
      tone: visit.status === "completed" ? "active" : "info",
    },
    {
      label: "Report",
      value: report ? formatLabel(report.status) : "Missing",
      detail: report
        ? `Confirmed ${formatDateTime(report.confirmedAt)}`
        : "Manual confirmation is still available",
      tone: report ? "active" : "warning",
    },
    {
      label: "Template",
      value: report ? formatLabel(report.templateCode) : "-",
      detail: report?.schemaVersion ?? "No report schema yet",
      tone: report ? "active" : "info",
    },
    {
      label: "AI quality",
      value: quality.label,
      detail: quality.detail,
      tone: quality.tone,
    },
    {
      label: "Created tasks",
      value: report ? String(report.createdTaskCount) : "-",
      detail: report
        ? report.createdTaskCount > 0
          ? "Follow-up tasks created from this report"
          : "No follow-up tasks created"
        : "No confirmed report yet",
      tone: report && report.createdTaskCount > 0 ? "active" : "info",
    },
  ];
}

function resolveReportQuality(report: Report | null): {
  label: string;
  detail: string;
  tone: "active" | "info" | "warning";
} {
  if (!report) {
    return {
      label: "Manual fallback",
      detail: "No confirmed report is available yet",
      tone: "warning",
    };
  }

  const reportData = normalizeReportData(report.confirmedData);
  const confidence =
    typeof reportData.confidence === "number" ? reportData.confidence : null;
  const metadata = normalizeReportData(report.aiMetadata);
  const source = typeof metadata.source === "string" ? metadata.source : null;

  if (source === "manual_text") {
    return {
      label: "Manual fallback",
      detail: "Confirmed manually without relying on AI output",
      tone: "active",
    };
  }

  if (confidence !== null && confidence < 0.6) {
    return {
      label: "Needs review",
      detail: `AI confidence ${Math.round(confidence * 100)}%`,
      tone: "warning",
    };
  }

  if (confidence !== null) {
    return {
      label: "Confirmed",
      detail: `AI confidence ${Math.round(confidence * 100)}%`,
      tone: "active",
    };
  }

  return {
    label: "Confirmed",
    detail: "Confirmed report is available",
    tone: "active",
  };
}

function normalizeReportData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function normalizeObjectList(value: unknown): Array<Record<string, unknown>> {
  return normalizeList(value).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function formatNestedValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "-";
    }

    return value.map(formatNestedValue).join("; ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${formatLabel(key)}: ${formatNestedValue(item)}`)
      .join("; ");
  }

  return formatScalarValue(value);
}

function formatScalarValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}
