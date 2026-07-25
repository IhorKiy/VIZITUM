import { AppShell } from "../../../../../components/app-shell";
import { BackLink } from "../../../../../components/back-link";
import {
  getVisit,
  getVisitReport,
  type Report,
  type Visit,
} from "../../../../../lib/api-client";
import { useFormatter, useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  formatDateTime,
  formatEnumLabel,
  formatEnumLabelOrDash,
  formatLabel,
  type CommonTranslator,
  type IntlFormatter,
} from "../../../../../lib/format";

type VisitDetailTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.visitDetail">>
>;

type ManagerVisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
};

export default async function ManagerVisitDetailPage({
  params,
}: ManagerVisitDetailPageProps) {
  const { tenantSlug, visitId } = await params;
  const [t, tManager, tCommon, format] = await Promise.all([
    getTranslations("manager.visitDetail"),
    getTranslations("manager"),
    getTranslations("common"),
    getFormatter(),
  ]);
  const [visitResult, reportResult] = await Promise.all([
    getVisit(visitId),
    getVisitReport(visitId),
  ]);

  if (!visitResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
        <BackLink
          href={`/${tenantSlug}/manager/visits`}
          label={t("backToVisits")}
        />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
        </header>

        <section className="notice-panel" aria-label={t("visitStatusAria")}>
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notAvailableTitle")}</h2>
            <p>{visitResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visit = visitResult.data;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
      <BackLink
        href={`/${tenantSlug}/manager/visits`}
        label={t("backToVisits")}
      />
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body", { location: visit.location.name })}</p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager/tasks`}>
            {t("tasks")}
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label={t("metadataAria")}>
        {buildVisitMetrics(
          visit,
          reportResult.ok ? reportResult.data : null,
          format,
          t,
          tCommon,
        ).map((metric) => (
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

      <section className="dashboard-grid" aria-label={t("detailAria")}>
        <article className="panel">
          <div className="panel-title-stack">
            <h2>{t("visitPanelTitle")}</h2>
            <p>{t("visitPanelBody")}</p>
          </div>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{t("rowLocation")}</th>
                <td>
                  {visit.location.name}, {visit.location.city}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("rowRepresentative")}</th>
                <td>{visit.representative.name}</td>
              </tr>
              <tr>
                <th scope="row">{t("rowVisitType")}</th>
                <td>{formatEnumLabel(tCommon, visit.visitType)}</td>
              </tr>
              <tr>
                <th scope="row">{t("rowStatus")}</th>
                <td>{formatEnumLabel(tCommon, visit.status)}</td>
              </tr>
              <tr>
                <th scope="row">{t("rowStarted")}</th>
                <td>{formatDateTime(format, visit.startedAt)}</td>
              </tr>
              <tr>
                <th scope="row">{t("rowCompleted")}</th>
                <td>{formatDateTime(format, visit.completedAt)}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article className="panel">
          {reportResult.ok ? (
            <ReportDetail report={reportResult.data} />
          ) : (
            <div className="empty-state-panel">
              <h2>{t("noReportTitle")}</h2>
              <p>{t("noReportBody", { message: reportResult.message })}</p>
              <a
                className="primary-button"
                href={`/${tenantSlug}/manager/visits`}
              >
                {t("backToVisits")}
              </a>
            </div>
          )}
        </article>
      </section>
    </AppShell>
  );
}

function ReportDetail({ report }: { report: Report }) {
  const t = useTranslations("manager.visitDetail");
  const format = useFormatter();
  const data = normalizeReportData(report.confirmedData);

  return (
    <>
      <div className="panel-title-stack">
        <h2>{t("confirmedReport")}</h2>
        <p>
          {t("templateConfirmed", {
            template: formatLabel(report.templateCode),
            date: formatDateTime(format, report.confirmedAt),
          })}
        </p>
      </div>
      <div className="report-detail-list">
        <TextReportSection title={t("sectionSummary")} value={data.summary} />
        <TextReportSection
          title={t("sectionResultStatus")}
          value={data.resultStatus}
        />
        <ListReportSection
          title={t("sectionAgreements")}
          value={data.agreements}
        />
        <ListReportSection
          title={t("sectionObjections")}
          value={data.objections}
        />
        <MentionedProductsSection
          title={t("sectionMentionedProducts")}
          value={data.mentionedProducts}
        />
        <ListReportSection
          title={t("sectionNextActions")}
          value={data.nextActions}
        />
        <CreatedTasksSection
          title={t("sectionCreatedTasks")}
          tasks={report.createdTasks}
        />
        <TasksToCreateSection
          title={t("sectionDraftTasks")}
          value={data.tasksToCreate}
        />
        <LocationUpdatesSection
          title={t("sectionLocationUpdates")}
          value={data.locationUpdates}
        />
        <KeyValueReportSection
          title={t("sectionTemplateSpecific")}
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
  const labels = useScalarLabels();

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      <p>{formatScalarValue(value, labels)}</p>
    </section>
  );
}

function useScalarLabels(): ScalarLabels {
  const t = useTranslations("manager.visitDetail");

  return { yes: t("yes"), no: t("no") };
}

function ListReportSection({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const labels = useScalarLabels();
  const items = normalizeList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul className="report-detail-items">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{formatScalarValue(item, labels)}</li>
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
  const tCommon = useTranslations("common");
  const labels = useScalarLabels();
  const products = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {products.length > 0 ? (
        <div className="report-detail-cards">
          {products.map((product, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatScalarValue(product.name, labels)}</strong>
              <span>{formatEnumLabelOrDash(tCommon, product.status)}</span>
              <p>{formatScalarValue(product.evidence, labels)}</p>
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
  const t = useTranslations("manager.visitDetail");
  const tCommon = useTranslations("common");

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
                {formatEnumLabel(tCommon, task.status)} ·{" "}
                {formatEnumLabel(tCommon, task.priority)}
                {task.dueDate
                  ? ` · ${t("dueDate", { date: task.dueDate })}`
                  : ""}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p>{t("noCreatedTasks")}</p>
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
  const t = useTranslations("manager.visitDetail");
  const tCommon = useTranslations("common");
  const labels = useScalarLabels();
  const tasks = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {tasks.length > 0 ? (
        <div className="report-detail-cards">
          {tasks.map((task, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatScalarValue(task.title, labels)}</strong>
              <span>
                {formatEnumLabelOrDash(tCommon, task.priority)} ·{" "}
                {formatEnumLabelOrDash(tCommon, task.assignee)} ·{" "}
                {t("dueDate", {
                  date: formatScalarValue(task.dueDate, labels),
                })}
              </span>
              <p>{formatScalarValue(task.description, labels)}</p>
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
  const tCommon = useTranslations("common");
  const labels = useScalarLabels();
  const updates = normalizeObjectList(value);

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {updates.length > 0 ? (
        <div className="report-detail-cards">
          {updates.map((update, index) => (
            <article className="report-detail-card" key={`${title}-${index}`}>
              <strong>{formatEnumLabelOrDash(tCommon, update.field)}</strong>
              <span>{formatScalarValue(update.proposedValue, labels)}</span>
              <p>{formatScalarValue(update.reason, labels)}</p>
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
  const labels = useScalarLabels();
  const entries = Object.entries(normalizeReportData(value));

  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      {entries.length > 0 ? (
        <dl className="report-detail-kv">
          {entries.map(([key, item]) => (
            <div key={key}>
              <dt>{formatLabel(key)}</dt>
              <dd>{formatNestedValue(item, labels)}</dd>
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
  format: IntlFormatter,
  t: VisitDetailTranslator,
  tCommon: CommonTranslator,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const quality = resolveReportQuality(report, t);

  return [
    {
      label: t("metricVisitStatus"),
      value: formatEnumLabel(tCommon, visit.status),
      detail: visit.location.name,
      tone: visit.status === "completed" ? "active" : "info",
    },
    {
      label: t("metricReport"),
      value: report
        ? formatEnumLabel(tCommon, report.status)
        : t("metricReportMissing"),
      detail: report
        ? t("metricReportConfirmed", {
            date: formatDateTime(format, report.confirmedAt),
          })
        : t("metricReportManualAvailable"),
      tone: report ? "active" : "warning",
    },
    {
      label: t("metricTemplate"),
      value: report ? formatLabel(report.templateCode) : "-",
      detail: report?.schemaVersion ?? t("metricNoSchema"),
      tone: report ? "active" : "info",
    },
    {
      label: t("metricAiQuality"),
      value: quality.label,
      detail: quality.detail,
      tone: quality.tone,
    },
    {
      label: t("metricCreatedTasks"),
      value: report ? String(report.createdTaskCount) : "-",
      detail: report
        ? report.createdTaskCount > 0
          ? t("metricTasksCreated")
          : t("metricNoTasksCreated")
        : t("metricNoReportYet"),
      tone: report && report.createdTaskCount > 0 ? "active" : "info",
    },
  ];
}

function resolveReportQuality(
  report: Report | null,
  t: VisitDetailTranslator,
): {
  label: string;
  detail: string;
  tone: "active" | "info" | "warning";
} {
  if (!report) {
    return {
      label: t("qualityManualFallback"),
      detail: t("qualityNoReport"),
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
      label: t("qualityManualFallback"),
      detail: t("qualityManualConfirmed"),
      tone: "active",
    };
  }

  if (confidence !== null && confidence < 0.6) {
    return {
      label: t("qualityNeedsReview"),
      detail: t("qualityConfidence", {
        percent: Math.round(confidence * 100),
      }),
      tone: "warning",
    };
  }

  if (confidence !== null) {
    return {
      label: t("qualityConfirmed"),
      detail: t("qualityConfidence", {
        percent: Math.round(confidence * 100),
      }),
      tone: "active",
    };
  }

  return {
    label: t("qualityConfirmed"),
    detail: t("qualityReportAvailable"),
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

type ScalarLabels = { yes: string; no: string };

function formatNestedValue(value: unknown, labels: ScalarLabels): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "-";
    }

    return value.map((item) => formatNestedValue(item, labels)).join("; ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(
        ([key, item]) =>
          `${formatLabel(key)}: ${formatNestedValue(item, labels)}`,
      )
      .join("; ");
  }

  return formatScalarValue(value, labels);
}

function formatScalarValue(value: unknown, labels: ScalarLabels): string {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? labels.yes : labels.no;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }

  // Objects/arrays are handled by formatNestedValue before reaching here.
  return JSON.stringify(value) ?? "-";
}
