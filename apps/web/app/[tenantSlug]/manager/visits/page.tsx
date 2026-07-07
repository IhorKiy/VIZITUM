import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  listAdminLocations,
  listTodayRoutes,
  listVisits,
  type ApiResult,
  type Location,
  type PaginatedResponse,
  type RoutePlan,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";
import { formatDateTime, formatEnumLabel } from "../../../../lib/format";

type ManagerVisitsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    locationId?: string;
    representativeUserId?: string;
    routePlanId?: string;
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

type FilterOption = {
  id: string;
  label: string;
};

export default async function ManagerVisitsPage({
  params,
  searchParams,
}: ManagerVisitsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [t, tManager, tCommon] = await Promise.all([
    getTranslations("manager.visits"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
  const selectedStatus = normalizeVisitStatus(pageState.status);
  const selectedRepresentativeId = normalizeFilterValue(
    pageState.representativeUserId,
  );
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const selectedRoutePlanId = normalizeFilterValue(pageState.routePlanId);
  const startedFrom = normalizeDateFilter(pageState.startedFrom);
  const startedTo = normalizeDateFilter(pageState.startedTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedRepresentativeId ||
    selectedLocationId ||
    selectedRoutePlanId ||
    startedFrom ||
    startedTo,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedRepresentativeId) {
    query.set("representativeUserId", selectedRepresentativeId);
  }

  if (selectedLocationId) {
    query.set("locationId", selectedLocationId);
  }

  if (selectedRoutePlanId) {
    query.set("routePlanId", selectedRoutePlanId);
  }

  if (startedFrom) {
    query.set("startedFrom", startedFrom);
  }

  if (startedTo) {
    query.set("startedTo", startedTo);
  }

  const visitsResult = await listVisits(query.toString());
  const allVisitsResult = hasFilters
    ? await listVisits("pageSize=100")
    : visitsResult;
  const routesResult = await listTodayRoutes();
  const locationsResult = await listAdminLocations("pageSize=100");

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
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
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.data.items;
  const counters = buildVisitCounters(visitsResult, t);
  const representativeOptions = allVisitsResult.ok
    ? buildRepresentativeOptions(allVisitsResult.data.items)
    : [];
  const locationOptions = locationsResult.ok
    ? buildLocationOptions(locationsResult.data.items)
    : [];
  const routeOptions = routesResult.ok
    ? buildRouteOptions(routesResult.data)
    : [];
  const selectedRepresentativeLabel =
    representativeOptions.find(
      (option) => option.id === selectedRepresentativeId,
    )?.label ?? null;
  const selectedRouteLabel =
    routeOptions.find((option) => option.id === selectedRoutePlanId)?.label ??
    null;
  const selectedLocationLabel =
    locationOptions.find((option) => option.id === selectedLocationId)?.label ??
    null;
  const filterSummary = selectedStatus
    ? t("summaryStatusVisits", {
        status: formatEnumLabel(tCommon, selectedStatus),
      })
    : t("summaryAllVisits");
  const detailSummary = [
    selectedRepresentativeLabel,
    selectedLocationLabel,
    selectedRouteLabel,
    startedFrom ? t("summaryFrom", { date: startedFrom }) : null,
    startedTo ? t("summaryTo", { date: startedTo }) : null,
  ].filter(Boolean);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            {t("overview")}
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
            {t("tasks")}
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
            <h2>{t("visitList")}</h2>
            <p>
              {t("showingSummary", {
                summary: filterSummary,
                details: detailSummary.length
                  ? `, ${detailSummary.join(", ")}`
                  : "",
              })}
            </p>
          </div>
          <div className="filter-pills" aria-label={t("statusFiltersAria")}>
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildVisitFilterHref(tenantSlug, null, {
                locationId: selectedLocationId,
                representativeUserId: selectedRepresentativeId,
                routePlanId: selectedRoutePlanId,
                startedFrom,
                startedTo,
              })}
            >
              {tCommon("all")}
            </a>
            {visitStatuses.map((visitStatus) => (
              <a
                aria-current={
                  selectedStatus === visitStatus ? "page" : undefined
                }
                href={buildVisitFilterHref(tenantSlug, visitStatus, {
                  locationId: selectedLocationId,
                  representativeUserId: selectedRepresentativeId,
                  routePlanId: selectedRoutePlanId,
                  startedFrom,
                  startedTo,
                })}
                key={visitStatus}
              >
                {formatEnumLabel(tCommon, visitStatus)}
              </a>
            ))}
          </div>
        </div>

        <form action={`/${tenantSlug}/manager/visits`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            {t("route")}
            <select defaultValue={selectedRoutePlanId ?? ""} name="routePlanId">
              <option value="">{t("anyRoute")}</option>
              {routeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("location")}
            <select defaultValue={selectedLocationId ?? ""} name="locationId">
              <option value="">{t("anyLocation")}</option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("representative")}
            <select
              defaultValue={selectedRepresentativeId ?? ""}
              name="representativeUserId"
            >
              <option value="">{t("anyRepresentative")}</option>
              {representativeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
                href={`/${tenantSlug}/manager/visits`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {visits.length > 0 ? (
          <VisitsTable tenantSlug={tenantSlug} visits={visits} />
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/visits`}
                >
                  {t("showAllVisits")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                {t("openFieldWorkspace")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function buildRouteOptions(routes: RoutePlan[]): FilterOption[] {
  return routes
    .map((route) => ({
      id: route.id,
      label: `${route.planDate} · ${route.representative.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRepresentativeOptions(visits: Visit[]): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const visit of visits) {
    options.set(visit.representative.id, {
      id: visit.representative.id,
      label: visit.representative.name,
    });
  }

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildLocationOptions(locations: Location[]): FilterOption[] {
  return locations
    .map((location) => ({
      id: location.id,
      label: location.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function VisitsTable({
  tenantSlug,
  visits,
}: {
  tenantSlug: string;
  visits: Visit[];
}) {
  const t = useTranslations("manager.visits");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>{t("tableLocation")}</th>
          <th>{t("tableRepresentative")}</th>
          <th>{t("tableStatus")}</th>
          <th>{t("tableType")}</th>
          <th>{t("tableStarted")}</th>
          <th>{t("tableCompleted")}</th>
          <th>{t("tableReport")}</th>
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
            <td>{visit.representative.name}</td>
            <td>
              <span className={`status-pill ${visitStatusTone(visit.status)}`}>
                {formatEnumLabel(tCommon, visit.status)}
              </span>
            </td>
            <td>{formatEnumLabel(tCommon, visit.visitType)}</td>
            <td>{formatDateTime(format, visit.startedAt)}</td>
            <td>{formatDateTime(format, visit.completedAt)}</td>
            <td>
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/visits/${visit.id}`}
              >
                {t("open")}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildVisitCounters(
  visitsResult: ApiResult<PaginatedResponse<Visit>>,
  t: Awaited<ReturnType<typeof getTranslations<"manager.visits">>>,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  if (!visitsResult.ok) {
    return [];
  }

  const visits = visitsResult.data.items;
  const completed = visits.filter((visit) => visit.status === "completed");
  const inProgress = visits.filter((visit) => visit.status === "in_progress");
  const waiting = visits.filter(
    (visit) => visit.status === "draft" || visit.status === "in_progress",
  );

  return [
    {
      label: t("visibleVisits"),
      value: String(visitsResult.data.total),
      detail: t("loadedOnPage", { count: visits.length }),
      tone: "active",
    },
    {
      label: t("reportsConfirmed"),
      value: String(completed.length),
      detail: t("waitingDetail", { count: waiting.length }),
      tone: completed.length > 0 ? "active" : "info",
    },
    {
      label: t("inProgress"),
      value: String(inProgress.length),
      detail: t("inProgressDetail"),
      tone: inProgress.length > 0 ? "warning" : "active",
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

function buildVisitFilterHref(
  tenantSlug: string,
  status: VisitStatus | null,
  filters: {
    locationId: string | null;
    representativeUserId: string | null;
    routePlanId: string | null;
    startedFrom: string | null;
    startedTo: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (filters.representativeUserId) {
    query.set("representativeUserId", filters.representativeUserId);
  }

  if (filters.locationId) {
    query.set("locationId", filters.locationId);
  }

  if (filters.routePlanId) {
    query.set("routePlanId", filters.routePlanId);
  }

  if (filters.startedFrom) {
    query.set("startedFrom", filters.startedFrom);
  }

  if (filters.startedTo) {
    query.set("startedTo", filters.startedTo);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/visits${suffix ? `?${suffix}` : ""}`;
}

function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue || null;
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
