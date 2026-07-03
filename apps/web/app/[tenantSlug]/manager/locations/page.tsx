import { AppShell } from "../../../../components/app-shell";
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

type FilterOption = {
  id: string;
  label: string;
};

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
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("dashboard.manager.read")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Coverage</h1>
            <p>
              Team Manager access is required before coverage review can
              continue.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="Permission status">
          <div>
            <p className="eyebrow">Permission required</p>
            <h2>Coverage is not available</h2>
            <p>Ask a Company Admin to assign the Team Manager role.</p>
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

  const locationsResult = await listAdminLocations(query.toString());
  const allLocationsResult = hasFilters
    ? await listAdminLocations("pageSize=100")
    : locationsResult;
  const [visitsResult, tasksResult] = await Promise.all([
    listVisits("pageSize=100"),
    listTasks("pageSize=100"),
  ]);

  if (!locationsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Coverage</h1>
            <p>
              Live tenant locations are required before coverage review can
              continue.
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
            <h2>Locations are not connected</h2>
            <p>{locationsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const locations = locationsResult.data.items;
  const allLocations = allLocationsResult.ok
    ? allLocationsResult.data.items
    : locations;
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const activityByLocation = buildLocationActivity(visits, tasks);
  const counters = buildLocationCounters(
    locations,
    locationsResult.data.total,
    activityByLocation,
  );
  const cityOptions = buildLocationOptions(allLocations, "city");
  const regionOptions = buildLocationOptions(allLocations, "region");
  const territoryOptions = buildLocationOptions(allLocations, "territory");
  const filterSummary = buildLocationFilterSummary({
    city: selectedCity,
    region: selectedRegion,
    search,
    status: selectedStatus,
    territory: selectedTerritory,
  });

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-locations">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Coverage</h1>
          <p>
            Review tenant locations, recent visit coverage and open follow-up
            work without admin edit rights.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            Overview
          </a>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/manager/visits`}
          >
            Visits
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
            Tasks
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Location metrics">
        {counters.map((counter) => (
          <article className="metric-card" key={counter.label}>
            <header>
              <p className="metric-label">{counter.label}</p>
              <span className={`status-pill ${counter.tone}`}>
                {counter.tone === "active" ? "OK" : counter.tone}
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
            <h2>Location coverage</h2>
            <p>Showing {filterSummary.toLowerCase()} for this tenant.</p>
          </div>
          <div className="filter-pills" aria-label="Location status filters">
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildLocationFilterHref(tenantSlug, {
                city: selectedCity,
                region: selectedRegion,
                search,
                status: null,
                territory: selectedTerritory,
              })}
            >
              All
            </a>
            {locationStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildLocationFilterHref(tenantSlug, {
                  city: selectedCity,
                  region: selectedRegion,
                  search,
                  status,
                  territory: selectedTerritory,
                })}
                key={status}
              >
                {formatLabel(status)}
              </a>
            ))}
          </div>
        </div>

        <form
          action={`/${tenantSlug}/manager/locations`}
          className="filter-form locations-filter-form"
        >
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            Search
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder="Name or code"
              type="search"
            />
          </label>
          <label>
            City
            <select defaultValue={selectedCity ?? ""} name="city">
              <option value="">Any city</option>
              {cityOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Region
            <select defaultValue={selectedRegion ?? ""} name="region">
              <option value="">Any region</option>
              {regionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Territory
            <select defaultValue={selectedTerritory ?? ""} name="territory">
              <option value="">Any territory</option>
              {territoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              Apply filters
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/locations`}
              >
                Reset
              </a>
            ) : null}
          </div>
        </form>

        {locations.length > 0 ? (
          <LocationsTable
            activityByLocation={activityByLocation}
            locations={locations}
            tenantSlug={tenantSlug}
          />
        ) : (
          <div className="empty-state-panel">
            <h2>No locations match this filter</h2>
            <p>
              Use another coverage filter or import active locations before
              reviewing territory activity here.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/locations`}
                >
                  Show all locations
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/manager`}>
                Open overview
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function LocationsTable({
  activityByLocation,
  locations,
  tenantSlug,
}: {
  activityByLocation: Map<string, LocationActivity>;
  locations: Location[];
  tenantSlug: string;
}) {
  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>Location</th>
          <th>Area</th>
          <th>Status</th>
          <th>Visits</th>
          <th>Open tasks</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {locations.map((location) => {
          const activity = activityByLocation.get(location.id);

          return (
            <tr key={location.id}>
              <td>
                <strong>{location.name}</strong>
                <span>
                  {location.addressLine}, {location.city}
                </span>
              </td>
              <td>
                <strong>{location.territory ?? "Unassigned"}</strong>
                <span>{location.region ?? location.type ?? "No region"}</span>
              </td>
              <td>
                <span
                  className={`status-pill ${locationStatusTone(
                    location.status,
                  )}`}
                >
                  {formatLabel(location.status)}
                </span>
              </td>
              <td>
                <strong>{activity?.visitCount ?? 0}</strong>
                <span>{formatDateTime(activity?.lastVisitAt ?? null)}</span>
              </td>
              <td>{activity?.openTaskCount ?? 0}</td>
              <td>
                <div className="table-actions">
                  <a
                    className="secondary-button"
                    href={`/${tenantSlug}/manager/visits?locationId=${location.id}`}
                  >
                    Visits
                  </a>
                  <a
                    className="secondary-button"
                    href={`/${tenantSlug}/manager/tasks?locationId=${location.id}`}
                  >
                    Tasks
                  </a>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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

function buildLocationCounters(
  locations: Location[],
  total: number,
  activityByLocation: Map<string, LocationActivity>,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const active = locations.filter((location) => location.status === "active");
  const withVisits = locations.filter(
    (location) => (activityByLocation.get(location.id)?.visitCount ?? 0) > 0,
  );
  const withOpenTasks = locations.filter(
    (location) => (activityByLocation.get(location.id)?.openTaskCount ?? 0) > 0,
  );

  return [
    {
      label: "Visible locations",
      value: String(total),
      detail: `${locations.length} loaded on this page`,
      tone: "active",
    },
    {
      label: "Active coverage",
      value: String(active.length),
      detail: `${withVisits.length} location(s) with visit activity`,
      tone: active.length > 0 ? "active" : "info",
    },
    {
      label: "Open follow-ups",
      value: String(withOpenTasks.length),
      detail: "Locations with open team tasks",
      tone: withOpenTasks.length > 0 ? "warning" : "active",
    },
  ];
}

function buildLocationOptions(
  locations: Location[],
  field: "city" | "region" | "territory",
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const location of locations) {
    const value = location[field]?.trim();

    if (!value) {
      continue;
    }

    options.set(value, {
      id: value,
      label: value,
    });
  }

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildLocationFilterHref(
  tenantSlug: string,
  filters: {
    city: string | null;
    region: string | null;
    search: string | null;
    status: LocationStatus | null;
    territory: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (filters.status) {
    query.set("status", filters.status);
  }

  if (filters.search) {
    query.set("search", filters.search);
  }

  if (filters.city) {
    query.set("city", filters.city);
  }

  if (filters.region) {
    query.set("region", filters.region);
  }

  if (filters.territory) {
    query.set("territory", filters.territory);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/locations${suffix ? `?${suffix}` : ""}`;
}

function buildLocationFilterSummary(filters: {
  city: string | null;
  region: string | null;
  search: string | null;
  status: LocationStatus | null;
  territory: string | null;
}): string {
  const parts = [
    filters.status
      ? `${formatLabel(filters.status)} locations`
      : "All locations",
    filters.search ? `matching "${filters.search}"` : null,
    filters.city ? `in ${filters.city}` : null,
    filters.region ? `region ${filters.region}` : null,
    filters.territory ? `territory ${filters.territory}` : null,
  ].filter(Boolean);

  return parts.join(", ");
}

function normalizeLocationStatus(
  value: string | undefined,
): LocationStatus | null {
  if (value === "active" || value === "inactive" || value === "archived") {
    return value;
  }

  return null;
}

function normalizeFilterValue(value: string | undefined): string | null {
  const normalizedValue = value?.trim();
  return normalizedValue || null;
}

function locationStatusTone(
  status: LocationStatus,
): "active" | "info" | "warning" {
  if (status === "active") {
    return "active";
  }

  if (status === "archived") {
    return "warning";
  }

  return "info";
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "No visits yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
