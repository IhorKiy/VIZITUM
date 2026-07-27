import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { AppShell } from "../../../../components/app-shell";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import { MapPinIcon, SearchIcon } from "../../../../components/icons";
import {
  getCurrentSession,
  getLocationInsightsSummary,
  listAdminLocations,
  listAllLocations,
  listTasks,
  listVisits,
  type Location,
  type LocationInsightsLocationSummary,
  type LocationStatus,
  type Task,
  type Visit,
} from "../../../../lib/api-client";
import { backOrigin, withBackOrigin } from "../../../../lib/back-navigation";
import { buildLocationFieldOptions } from "../../../../lib/filter-options";
import {
  formatDateTime,
  formatEnumLabel,
  normalizeFilterValue,
  normalizeLocationStatus,
  statusTone,
} from "../../../../lib/format";
import { INPUT_LIMITS } from "../../../../lib/input-limits";
import { isTaskUnfinished } from "../../../../lib/task-status";

type ManagerLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    city?: string;
    search?: string;
    status?: string;
    sort?: string;
    dir?: string;
  }>;
};

type LocationSortKey = "totalPotential" | "coveragePct";

function normalizeSortKey(value: string | undefined): LocationSortKey | null {
  return value === "totalPotential" || value === "coveragePct" ? value : null;
}

const locationStatuses: LocationStatus[] = ["active", "inactive", "archived"];

type LocationActivity = {
  openTaskCount: number;
  visitCount: number;
  lastVisitAt: string | null;
};

export default async function ManagerLocationsPage({
  params,
  searchParams,
}: ManagerLocationsPageProps) {
  const { tenantSlug } = await params;
  const [locale, t, tManager, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("manager.locations"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("dashboard.manager.read")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
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
  const selectedStatus = normalizeLocationStatus(pageState.status);
  const selectedCity = normalizeFilterValue(pageState.city);
  const search = normalizeFilterValue(pageState.search);
  const query = new URLSearchParams({ pageSize: "100" });
  // User-facing filter params only — kept separate from `query` above so the
  // sort links' href doesn't leak the API-only `pageSize` param into the
  // browser URL.
  const filterParams = new URLSearchParams();
  const hasFilters = Boolean(selectedStatus || selectedCity || search);

  if (selectedStatus) {
    query.set("status", selectedStatus);
    filterParams.set("status", selectedStatus);
  }

  if (selectedCity) {
    query.set("city", selectedCity);
    filterParams.set("city", selectedCity);
  }

  if (search) {
    query.set("search", search);
    filterParams.set("search", search);
  }

  const sortKey = normalizeSortKey(pageState.sort);
  const sortDir = pageState.dir === "asc" ? "asc" : "desc";
  const productsEnabled = sessionResult.data.productsEnabled;
  // A location opened from here returns to this list with the same filters and
  // sort, not to a reset page.
  const listOrigin = backOrigin("/manager/locations", {
    city: selectedCity,
    search,
    status: selectedStatus,
    sort: sortKey ?? undefined,
    dir: sortKey ? sortDir : undefined,
  });

  const [
    locationsResult,
    allLocationsResult,
    visitsResult,
    tasksResult,
    summaryResult,
  ] = await Promise.all([
    listAdminLocations(query.toString()),
    listAllLocations(),
    listVisits("pageSize=100"),
    listTasks("pageSize=100"),
    productsEnabled
      ? getLocationInsightsSummary()
      : Promise.resolve({
          ok: false as const,
          status: 0,
          message: "Not available",
        }),
  ]);
  const allLocations = allLocationsResult.ok ? allLocationsResult.data : [];

  if (!locationsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
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
            <p>{locationsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const locations = locationsResult.data.items;
  const locationOptionsSource =
    allLocations.length > 0 ? allLocations : locations;
  const locationCategoriesEnabled =
    sessionResult.data.locationCategoriesEnabled;
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const activityByLocation = buildLocationActivity(visits, tasks);
  const insightsByLocation = new Map<string, LocationInsightsLocationSummary>(
    summaryResult.ok
      ? summaryResult.data.locations.map((entry) => [entry.locationId, entry])
      : [],
  );
  // Sorts only `locations` — the single ≤100-row page already fetched above
  // — not the tenant's full location set. Real server-side sort/pagination
  // is out of scope here; don't mistake this for a full-dataset sort later.
  const sortedLocations = sortKey
    ? [...locations].sort((a, b) => {
        const aValue = insightsByLocation.get(a.id)?.[sortKey] ?? 0;
        const bValue = insightsByLocation.get(b.id)?.[sortKey] ?? 0;
        return sortDir === "asc" ? aValue - bValue : bValue - aValue;
      })
    : locations;
  const counters = buildLocationCounters(
    locations,
    locationsResult.data.total,
    activityByLocation,
    t,
  );
  const cityOptions = buildLocationFieldOptions(
    locationOptionsSource,
    "city",
    locale,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
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

      <section
        aria-label={t("locationCoverage")}
        className="panel drilldown-panel"
      >
        <FilterForm action={`/${tenantSlug}/manager/locations`}>
          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("statusFiltersAria")}
              name="status"
              options={[
                { label: tCommon("all"), value: "" },
                ...locationStatuses.map((status) => ({
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
            <div className="filter-form locations-filter-form">
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  maxLength={INPUT_LIMITS.search}
                  name="search"
                  placeholder={t("searchPlaceholder")}
                  type="search"
                />
              </FilterField>
              <FilterField icon={<MapPinIcon />} label={t("city")}>
                <select defaultValue={selectedCity ?? ""} name="city">
                  <option value="">{tCommon("anyOption")}</option>
                  {cityOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/manager/locations` : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: locationsResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {locations.length > 0 ? (
          <LocationsTable
            activityByLocation={activityByLocation}
            insightsByLocation={insightsByLocation}
            listOrigin={listOrigin}
            locationCategoriesEnabled={locationCategoriesEnabled}
            locations={sortedLocations}
            productsEnabled={productsEnabled}
            sortDir={sortDir}
            sortHrefBase={`/${tenantSlug}/manager/locations?${filterParams.toString()}`}
            sortKey={sortKey}
            tenantSlug={tenantSlug}
          />
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/locations`}
                >
                  {t("showAllLocations")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/manager`}>
                {t("openOverview")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function SortableColumnHeader({
  active,
  children,
  column,
  dir,
  hrefBase,
}: {
  active: boolean;
  children: ReactNode;
  column: LocationSortKey;
  dir: "asc" | "desc";
  hrefBase: string;
}) {
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  const params = new URLSearchParams(hrefBase.split("?")[1] ?? "");
  params.set("sort", column);
  params.set("dir", nextDir);
  const [path] = hrefBase.split("?");

  return (
    <th
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <a
        className="sortable-column-header"
        href={`${path}?${params.toString()}`}
      >
        {children}
        {active ? (
          <span aria-hidden="true">{dir === "asc" ? " ▲" : " ▼"}</span>
        ) : null}
      </a>
    </th>
  );
}

function LocationsTable({
  activityByLocation,
  insightsByLocation,
  listOrigin,
  locationCategoriesEnabled,
  locations,
  productsEnabled,
  sortDir,
  sortHrefBase,
  sortKey,
  tenantSlug,
}: {
  activityByLocation: Map<string, LocationActivity>;
  insightsByLocation: Map<string, LocationInsightsLocationSummary>;
  listOrigin: string;
  locationCategoriesEnabled: boolean;
  locations: Location[];
  productsEnabled: boolean;
  sortDir: "asc" | "desc";
  sortHrefBase: string;
  sortKey: LocationSortKey | null;
  tenantSlug: string;
}) {
  const t = useTranslations("manager.locations");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <div className="locations-table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t("tableLocation")}</th>
            {locationCategoriesEnabled ? <th>{t("tableCategory")}</th> : null}
            <th>{t("tableVisits")}</th>
            <th>{t("tableOpenTasks")}</th>
            {productsEnabled ? (
              <>
                <SortableColumnHeader
                  active={sortKey === "totalPotential"}
                  column="totalPotential"
                  dir={sortDir}
                  hrefBase={sortHrefBase}
                >
                  {t("tableTotalPotential")}
                </SortableColumnHeader>
                <SortableColumnHeader
                  active={sortKey === "coveragePct"}
                  column="coveragePct"
                  dir={sortDir}
                  hrefBase={sortHrefBase}
                >
                  {t("tableCoverage")}
                </SortableColumnHeader>
              </>
            ) : null}
            <th>
              <span className="sr-only">{t("tableLinks")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => {
            const activity = activityByLocation.get(location.id);
            const visitCount = activity?.visitCount ?? 0;
            const insights = insightsByLocation.get(location.id);
            const displayStatus = location.archived
              ? "archived"
              : location.status;

            return (
              <tr key={location.id}>
                <td>
                  <span className={`status-pill ${statusTone(displayStatus)}`}>
                    {formatEnumLabel(tCommon, displayStatus)}
                  </span>{" "}
                  <a
                    className="list-card-open"
                    href={withBackOrigin(
                      `/${tenantSlug}/manager/locations/${location.id}`,
                      listOrigin,
                    )}
                  >
                    <strong>{location.name}</strong>
                  </a>
                  <br />
                  {location.addressLine}, {location.city}
                </td>
                {locationCategoriesEnabled ? (
                  <td>
                    {location.category
                      ? formatEnumLabel(tCommon, location.category.name)
                      : t("noType")}
                  </td>
                ) : null}
                <td>
                  {visitCount > 0
                    ? `${visitCount} · ${formatDateTime(
                        format,
                        activity?.lastVisitAt ?? null,
                        t("noVisitsYet"),
                      )}`
                    : t("noVisitsYet")}
                </td>
                <td>{activity?.openTaskCount ?? 0}</td>
                {productsEnabled ? (
                  <>
                    <td>{format.number(insights?.totalPotential ?? 0)}</td>
                    <td>{insights?.coveragePct ?? 0}%</td>
                  </>
                ) : null}
                <td>
                  <a
                    className="list-card-open"
                    href={`/${tenantSlug}/manager/visits?locationId=${location.id}`}
                  >
                    {t("visits")}
                  </a>{" "}
                  <a
                    className="list-card-open"
                    href={`/${tenantSlug}/manager/tasks?locationId=${location.id}`}
                  >
                    {t("tasks")}
                  </a>
                  {/* Only worth offering where the assortment exists at all —
                      a products-disabled tenant has no matrix to edit. */}
                  {productsEnabled ? (
                    <>
                      {" "}
                      <a
                        className="list-card-open"
                        href={withBackOrigin(
                          `/${tenantSlug}/manager/locations/${location.id}`,
                          listOrigin,
                        )}
                      >
                        {t("assortment")}
                      </a>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildLocationActivity(
  visits: Visit[],
  tasks: Task[],
): Map<string, LocationActivity> {
  const activityByLocation = new Map<string, LocationActivity>();

  for (const visit of visits) {
    const activity = getLocationActivity(activityByLocation, visit.locationId);
    activity.visitCount += 1;

    const visitDate = visit.completedAt ?? visit.startedAt ?? visit.createdAt;
    if (
      visitDate &&
      (!activity.lastVisitAt ||
        new Date(visitDate).getTime() >
          new Date(activity.lastVisitAt).getTime())
    ) {
      activity.lastVisitAt = visitDate;
    }
  }

  for (const task of tasks) {
    if (!task.locationId || !isTaskUnfinished(task.status)) {
      continue;
    }

    const activity = getLocationActivity(activityByLocation, task.locationId);
    activity.openTaskCount += 1;
  }

  return activityByLocation;
}

function getLocationActivity(
  activityByLocation: Map<string, LocationActivity>,
  locationId: string,
): LocationActivity {
  const existingActivity = activityByLocation.get(locationId);

  if (existingActivity) {
    return existingActivity;
  }

  const activity = {
    lastVisitAt: null,
    openTaskCount: 0,
    visitCount: 0,
  };
  activityByLocation.set(locationId, activity);

  return activity;
}

type LocationsTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.locations">>
>;

function buildLocationCounters(
  locations: Location[],
  total: number,
  activityByLocation: Map<string, LocationActivity>,
  t: LocationsTranslator,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  // Archived rows keep their pre-archive status, so status alone would count
  // them (the archived filter loads only such rows).
  const active = locations.filter(
    (location) => location.status === "active" && !location.archived,
  );
  const withVisits = locations.filter(
    (location) => (activityByLocation.get(location.id)?.visitCount ?? 0) > 0,
  );
  const withOpenTasks = locations.filter(
    (location) => (activityByLocation.get(location.id)?.openTaskCount ?? 0) > 0,
  );

  return [
    {
      label: t("visibleLocations"),
      value: String(total),
      detail: t("loadedOnPage", { count: locations.length }),
      tone: "active",
    },
    {
      label: t("activeCoverage"),
      value: String(active.length),
      detail: t("activeCoverageDetail", { count: withVisits.length }),
      tone: active.length > 0 ? "active" : "info",
    },
    {
      label: t("openFollowUps"),
      value: String(withOpenTasks.length),
      detail: t("openFollowUpsDetail"),
      tone: withOpenTasks.length > 0 ? "warning" : "active",
    },
  ];
}
