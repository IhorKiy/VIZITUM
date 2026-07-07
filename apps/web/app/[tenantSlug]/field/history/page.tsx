import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  getCurrentSession,
  listVisits,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";
import {
  formatDateTime,
  formatEnumLabel,
  type CommonTranslator,
} from "../../../../lib/format";

type FieldHistoryPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    startedFrom?: string;
    startedTo?: string;
    status?: string;
  }>;
};

const visitStatuses: VisitStatus[] = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
];

export default async function FieldHistoryPage({
  params,
  searchParams,
}: FieldHistoryPageProps) {
  const { tenantSlug } = await params;
  const [t, tField, tCommon] = await Promise.all([
    getTranslations("field.history"),
    getTranslations("field"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("visits.read_own")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("permissionBody")}</p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={t("permissionStatusAria")}
        >
          <div>
            <p className="eyebrow">{t("permissionRequiredEyebrow")}</p>
            <h2>{t("permissionRequiredTitle")}</h2>
            <p>{t("permissionRequiredBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pageState = await searchParams;
  const selectedStatus = normalizeVisitStatus(pageState.status);
  const startedFrom = normalizeDateFilter(pageState.startedFrom);
  const startedTo = normalizeDateFilter(pageState.startedTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(selectedStatus || startedFrom || startedTo);

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (startedFrom) {
    query.set("startedFrom", startedFrom);
  }

  if (startedTo) {
    query.set("startedTo", startedTo);
  }

  const visitsResult = await listVisits(query.toString());

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
            <p>{t("connectionBody")}</p>
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
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.data.items;
  const counters = buildHistoryCounters(visits, visitsResult.data.total, t);
  const filterSummary = buildHistoryFilterSummary(
    {
      startedFrom,
      startedTo,
      status: selectedStatus,
    },
    t,
    tCommon,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-history">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tField("flowEyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {t("today")}
          </a>
          <a className="primary-button" href={`/${tenantSlug}/field#new-visit`}>
            {t("newVisit")}
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label={t("metricsAria")}>
        {counters.map((counter) => (
          <article className="metric-card" key={counter.label}>
            <header>
              <p className="metric-label">{counter.label}</p>
              <span className={`status-pill ${counter.tone}`}>
                {counter.tone === "active"
                  ? tCommon("tone.ok")
                  : tCommon(`tone.${counter.tone}`)}
              </span>
            </header>
            <p className="metric-value">{counter.value}</p>
            <p className="small-label">{counter.detail}</p>
          </article>
        ))}
      </section>

      <section className="panel drilldown-panel">
        <div className="panel-toolbar">
          <div className="panel-title-stack">
            <h2>{t("myVisits")}</h2>
            <p>{t("showingSummary", { summary: filterSummary })}</p>
          </div>
          <div className="filter-pills" aria-label={t("statusFiltersAria")}>
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildHistoryFilterHref(tenantSlug, null, {
                startedFrom,
                startedTo,
              })}
            >
              {tCommon("all")}
            </a>
            {visitStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildHistoryFilterHref(tenantSlug, status, {
                  startedFrom,
                  startedTo,
                })}
                key={status}
              >
                {formatEnumLabel(tCommon, status)}
              </a>
            ))}
          </div>
        </div>

        <form
          action={`/${tenantSlug}/field/history`}
          className="filter-form field-history-filter-form"
        >
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            {t("startedFrom")}
            <input
              defaultValue={startedFrom ?? ""}
              name="startedFrom"
              type="date"
            />
          </label>
          <label>
            {t("startedTo")}
            <input
              defaultValue={startedTo ?? ""}
              name="startedTo"
              type="date"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              {tCommon("applyFilters")}
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/field/history`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {visits.length > 0 ? (
          <HistoryTable visits={visits} />
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/field/history`}
                >
                  {t("showAllVisits")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                {t("openToday")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function HistoryTable({ visits }: { visits: Visit[] }) {
  const t = useTranslations("field.history");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>{t("tableLocation")}</th>
          <th>{t("tableStatus")}</th>
          <th>{t("tableType")}</th>
          <th>{t("tableStarted")}</th>
          <th>{t("tableCompleted")}</th>
        </tr>
      </thead>
      <tbody>
        {visits.map((visit) => (
          <tr key={visit.id}>
            <td>
              <strong>{visit.location.name}</strong>
              <span>
                {visit.location.addressLine}, {visit.location.city}
              </span>
            </td>
            <td>
              <span className={`status-pill ${visitStatusTone(visit.status)}`}>
                {formatEnumLabel(tCommon, visit.status)}
              </span>
            </td>
            <td>{formatEnumLabel(tCommon, visit.visitType)}</td>
            <td>{formatDateTime(format, visit.startedAt)}</td>
            <td>{formatDateTime(format, visit.completedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type HistoryTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.history">>
>;

function buildHistoryCounters(
  visits: Visit[],
  total: number,
  t: HistoryTranslator,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const completed = visits.filter((visit) => visit.status === "completed");
  const unfinished = visits.filter(
    (visit) => visit.status === "draft" || visit.status === "in_progress",
  );

  return [
    {
      label: t("visibleVisits"),
      value: String(total),
      detail: t("loadedOnPage", { count: visits.length }),
      tone: "active",
    },
    {
      label: t("completedLabel"),
      value: String(completed.length),
      detail: t("completedDetail"),
      tone: completed.length > 0 ? "active" : "info",
    },
    {
      label: t("needsFollowUp"),
      value: String(unfinished.length),
      detail: t("needsFollowUpDetail"),
      tone: unfinished.length > 0 ? "warning" : "active",
    },
  ];
}

function buildHistoryFilterHref(
  tenantSlug: string,
  status: VisitStatus | null,
  filters: {
    startedFrom: string | null;
    startedTo: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (filters.startedFrom) {
    query.set("startedFrom", filters.startedFrom);
  }

  if (filters.startedTo) {
    query.set("startedTo", filters.startedTo);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/field/history${suffix ? `?${suffix}` : ""}`;
}

function buildHistoryFilterSummary(
  filters: {
    startedFrom: string | null;
    startedTo: string | null;
    status: VisitStatus | null;
  },
  t: HistoryTranslator,
  tCommon: CommonTranslator,
): string {
  const parts = [
    filters.status
      ? t("summaryStatusVisits", {
          status: formatEnumLabel(tCommon, filters.status),
        })
      : t("summaryAllVisits"),
    filters.startedFrom
      ? t("summaryFrom", { date: filters.startedFrom })
      : null,
    filters.startedTo ? t("summaryTo", { date: filters.startedTo }) : null,
  ].filter(Boolean);

  return parts.join(", ");
}

function normalizeVisitStatus(value: string | undefined): VisitStatus | null {
  if (
    value === "draft" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeDateFilter(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function visitStatusTone(status: VisitStatus): "active" | "info" | "warning" {
  if (status === "completed") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}
