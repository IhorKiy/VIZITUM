import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { FilterDateRange } from "../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import {
  getCurrentSession,
  listVisits,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";
import { formatDateTime, formatEnumLabel } from "../../../../lib/format";

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

      <section aria-label={t("myVisits")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/field/history`}>
          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="status"
              options={[
                { label: tCommon("all"), value: "" },
                ...visitStatuses.map((status) => ({
                  label: formatEnumLabel(tCommon, status),
                  value: status,
                })),
              ]}
              value={selectedStatus ?? ""}
            />
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form field-history-filter-form">
              <FilterDateRange
                fromLabel={t("startedFrom")}
                fromName="startedFrom"
                fromValue={startedFrom ?? ""}
                label={t("visitPeriod")}
                placeholder={tCommon("datePlaceholder")}
                toLabel={t("startedTo")}
                toName="startedTo"
                toValue={startedTo ?? ""}
              />
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/field/history` : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: visitsResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

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
