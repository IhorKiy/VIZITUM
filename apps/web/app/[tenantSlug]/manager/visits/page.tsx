import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  CalendarIcon,
  CheckIcon,
  MapPinIcon,
  RouteIcon,
  TagIcon,
  UserIcon,
} from "../../../../components/icons";
import {
  listAdminLocations,
  listTodayRoutes,
  listVisits,
  type ApiResult,
  type PaginatedResponse,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";
import {
  buildLocationOptions,
  buildRouteOptions,
  type FilterOption,
} from "../../../../lib/filter-options";
import {
  formatDateTime,
  formatEnumLabel,
  statusPillTone,
} from "../../../../lib/format";

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

export default async function ManagerVisitsPage({
  params,
  searchParams,
}: ManagerVisitsPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [locale, t, tManager, tCommon] = await Promise.all([
    getLocale(),
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
    ? buildRepresentativeOptions(allVisitsResult.data.items, locale)
    : [];
  const locationOptions = locationsResult.ok
    ? buildLocationOptions(locationsResult.data.items, locale)
    : [];
  const routeOptions = routesResult.ok
    ? buildRouteOptions(routesResult.data, locale)
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

        <details className="filter-disclosure" open={hasFilters}>
          <summary className="filter-disclosure-summary">
            {tCommon("filtersLabel")}
            {hasFilters ? (
              <span aria-hidden="true" className="filter-active-dot" />
            ) : null}
          </summary>
          <form
            action={`/${tenantSlug}/manager/visits`}
            className="filter-form"
          >
            {selectedStatus ? (
              <input name="status" type="hidden" value={selectedStatus} />
            ) : null}
            <label>
              <span className="filter-field-icon" title={t("route")}>
                <RouteIcon />
                <span className="sr-only">{t("route")}</span>
              </span>
              <select
                defaultValue={selectedRoutePlanId ?? ""}
                name="routePlanId"
              >
                <option value="">{t("anyRoute")}</option>
                {routeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="filter-field-icon" title={t("location")}>
                <MapPinIcon />
                <span className="sr-only">{t("location")}</span>
              </span>
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
              <span className="filter-field-icon" title={t("representative")}>
                <UserIcon />
                <span className="sr-only">{t("representative")}</span>
              </span>
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
              <span className="filter-field-icon" title={t("startedFrom")}>
                <CalendarIcon />
                <span className="sr-only">{t("startedFrom")}</span>
              </span>
              <input
                defaultValue={startedFrom ?? ""}
                name="startedFrom"
                type="date"
              />
            </label>
            <label>
              <span className="filter-field-icon" title={t("startedTo")}>
                <CalendarIcon />
                <span className="sr-only">{t("startedTo")}</span>
              </span>
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
        </details>

        {visits.length > 0 ? (
          <VisitsCards tenantSlug={tenantSlug} visits={visits} />
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

function buildRepresentativeOptions(
  visits: Visit[],
  locale: string,
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const visit of visits) {
    options.set(visit.representative.id, {
      id: visit.representative.id,
      label: visit.representative.name,
    });
  }

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

function VisitsCards({
  tenantSlug,
  visits,
}: {
  tenantSlug: string;
  visits: Visit[];
}) {
  const t = useTranslations("manager.visits");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // Same card layout as the manager task list (shared .task-card* styles): the
  // location is the title, the status pill sits top-right, the facts row uses
  // the same icon language, and an "open" link mirrors the task card's footer.
  return (
    <ul className="task-cards">
      {visits.map((visit) => (
        <li className="task-card" key={visit.id}>
          <div className="task-card-top">
            <h3 className="task-card-title">{visit.location.name}</h3>
            <span className={`status-pill ${statusPillTone(visit.status)}`}>
              {formatEnumLabel(tCommon, visit.status)}
            </span>
          </div>
          <dl className="task-card-facts">
            <div className="task-fact">
              <dt>
                <UserIcon />
                <span className="sr-only">{t("tableRepresentative")}</span>
              </dt>
              <dd>{visit.representative.name}</dd>
            </div>
            <div className="task-fact">
              <dt>
                <MapPinIcon />
                <span className="sr-only">{t("tableLocation")}</span>
              </dt>
              <dd>
                {visit.location.addressLine}, {visit.location.city}
              </dd>
            </div>
            <div className="task-fact">
              <dt>
                <TagIcon />
                <span className="sr-only">{t("tableType")}</span>
              </dt>
              <dd>{formatEnumLabel(tCommon, visit.visitType)}</dd>
            </div>
            <div className="task-fact">
              <dt>
                <CalendarIcon />
                <span className="sr-only">{t("tableStarted")}</span>
              </dt>
              <dd>{formatDateTime(format, visit.startedAt)}</dd>
            </div>
            {visit.completedAt ? (
              <div className="task-fact">
                <dt>
                  <CheckIcon />
                  <span className="sr-only">{t("tableCompleted")}</span>
                </dt>
                <dd>{formatDateTime(format, visit.completedAt)}</dd>
              </div>
            ) : null}
          </dl>
          <a
            className="task-card-open"
            href={`/${tenantSlug}/manager/visits/${visit.id}`}
          >
            {t("open")}
          </a>
        </li>
      ))}
    </ul>
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
