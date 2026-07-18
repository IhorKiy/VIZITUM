import { AppShell } from "../../../../components/app-shell";
import { CardFact } from "../../../../components/card-fact";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
import { FilterPills } from "../../../../components/filter-pills";
import {
  CalendarIcon,
  FlagIcon,
  MapIcon,
  MapPinIcon,
  SearchIcon,
  TagIcon,
} from "../../../../components/icons";
import {
  getCurrentSession,
  listAdminLocations,
  listTasks,
  listVisits,
  type Location,
  type LocationStatus,
  type Task,
  type Visit,
} from "../../../../lib/api-client";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { buildLocationFieldOptions } from "../../../../lib/filter-options";
import {
  formatDateTime,
  formatEnumLabel,
  normalizeFilterValue,
  statusTone,
} from "../../../../lib/format";

type ManagerLocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    city?: string;
    region?: string;
    search?: string;
    status?: string;
    territory?: string;
  }>;
};

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
  const selectedRegion = normalizeFilterValue(pageState.region);
  const selectedTerritory = normalizeFilterValue(pageState.territory);
  const search = normalizeFilterValue(pageState.search);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedCity ||
    selectedRegion ||
    selectedTerritory ||
    search,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedCity) {
    query.set("city", selectedCity);
  }

  if (selectedRegion) {
    query.set("region", selectedRegion);
  }

  if (selectedTerritory) {
    query.set("territory", selectedTerritory);
  }

  if (search) {
    query.set("search", search);
  }

  const [locationsResult, allLocations, visitsResult, tasksResult] =
    await Promise.all([
      listAdminLocations(query.toString()),
      fetchAllLocations(),
      listVisits("pageSize=100"),
      listTasks("pageSize=100"),
    ]);

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
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const activityByLocation = buildLocationActivity(visits, tasks);
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
  const regionOptions = buildLocationFieldOptions(
    locationOptionsSource,
    "region",
    locale,
  );
  const territoryOptions = buildLocationFieldOptions(
    locationOptionsSource,
    "territory",
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
              <FilterField icon={<MapIcon />} label={t("region")}>
                <select defaultValue={selectedRegion ?? ""} name="region">
                  <option value="">{tCommon("anyOption")}</option>
                  {regionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<TagIcon />} label={t("territory")}>
                <select defaultValue={selectedTerritory ?? ""} name="territory">
                  <option value="">{tCommon("anyOption")}</option>
                  {territoryOptions.map((option) => (
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
          <LocationsCards
            activityByLocation={activityByLocation}
            locations={locations}
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

function LocationsCards({
  activityByLocation,
  locations,
  tenantSlug,
}: {
  activityByLocation: Map<string, LocationActivity>;
  locations: Location[];
  tenantSlug: string;
}) {
  const t = useTranslations("manager.locations");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // The location is the title, the status pill sits top-right, and the footer
  // holds the per-location drill-down links.
  return (
    <ul className="list-cards">
      {locations.map((location) => {
        const activity = activityByLocation.get(location.id);
        const visitCount = activity?.visitCount ?? 0;
        const area = [
          location.territory ?? t("unassignedTerritory"),
          location.region ?? location.type ?? t("noRegion"),
        ].join(" · ");
        const displayStatus = location.archived ? "archived" : location.status;

        return (
          <li className="list-card" key={location.id}>
            <div className="list-card-top">
              <h3 className="list-card-title">{location.name}</h3>
              <span className={`status-pill ${statusTone(displayStatus)}`}>
                {formatEnumLabel(tCommon, displayStatus)}
              </span>
            </div>
            <dl className="list-card-facts">
              <CardFact icon={<MapPinIcon />} label={t("tableLocation")}>
                {location.addressLine}, {location.city}
              </CardFact>
              <CardFact icon={<TagIcon />} label={t("tableArea")}>
                {area}
              </CardFact>
              <CardFact icon={<CalendarIcon />} label={t("tableVisits")}>
                {visitCount > 0
                  ? `${visitCount} · ${formatDateTime(
                      format,
                      activity?.lastVisitAt ?? null,
                      t("noVisitsYet"),
                    )}`
                  : t("noVisitsYet")}
              </CardFact>
              <CardFact icon={<FlagIcon />} label={t("tableOpenTasks")}>
                {activity?.openTaskCount ?? 0}
              </CardFact>
            </dl>
            <div className="list-card-links">
              <a
                className="list-card-open"
                href={`/${tenantSlug}/manager/visits?locationId=${location.id}`}
              >
                {t("visits")}
              </a>
              <a
                className="list-card-open"
                href={`/${tenantSlug}/manager/tasks?locationId=${location.id}`}
              >
                {t("tasks")}
              </a>
            </div>
          </li>
        );
      })}
    </ul>
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
    if (
      !task.locationId ||
      task.status === "done" ||
      task.status === "cancelled"
    ) {
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

async function fetchAllLocations(): Promise<Location[]> {
  const first = await listAdminLocations("pageSize=100&page=1");

  if (!first.ok) {
    return [];
  }

  const items = [...first.data.items];
  const remainingPages = first.data.totalPages - first.data.page;

  if (remainingPages > 0) {
    const pages = await Promise.all(
      Array.from({ length: remainingPages }, (_, index) =>
        listAdminLocations(`pageSize=100&page=${first.data.page + index + 1}`),
      ),
    );

    for (const page of pages) {
      if (page.ok) {
        items.push(...page.data.items);
      }
    }
  }

  return items;
}

function normalizeLocationStatus(
  value: string | undefined,
): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}
