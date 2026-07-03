import { AppShell } from "../../../../components/app-shell";
import {
  getCurrentSession,
  listRoutes,
  listTasks,
  listVisits,
  type RoutePlan,
  type Task,
  type Visit,
} from "../../../../lib/api-client";
import {
  formatDateTime,
  normalizeFilterValue,
} from "../../../../lib/format";

type ManagerRepresentativesPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    activity?: string;
    search?: string;
  }>;
};

type RepresentativeActivityFilter = "has_visits" | "open_tasks" | "no_activity";

type RepresentativeSummary = {
  id: string;
  email: string;
  name: string;
  completedVisitCount: number;
  lastActivityAt: string | null;
  openTaskCount: number;
  routeCount: number;
  taskCount: number;
  visitCount: number;
};

const activityFilters: Array<{
  value: RepresentativeActivityFilter;
  label: string;
}> = [
  { value: "has_visits", label: "With visits" },
  { value: "open_tasks", label: "Open tasks" },
  { value: "no_activity", label: "No activity" },
];

export default async function ManagerRepresentativesPage({
  params,
  searchParams,
}: ManagerRepresentativesPageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("dashboard.manager.read")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Representatives</h1>
            <p>
              Team Manager access is required before representative review can
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
            <h2>Representatives are not available</h2>
            <p>Ask a Company Admin to assign the Team Manager role.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pageState = await searchParams;
  const search = normalizeFilterValue(pageState.search);
  const selectedActivity = normalizeActivityFilter(pageState.activity);
  const hasFilters = Boolean(search || selectedActivity);
  const [routesResult, visitsResult, tasksResult] = await Promise.all([
    listRoutes("pageSize=100"),
    listVisits("pageSize=100"),
    listTasks("pageSize=100"),
  ]);

  if (!routesResult.ok && !visitsResult.ok && !tasksResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Representatives</h1>
            <p>
              Live route, visit or task data is required before representative
              review can continue.
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
            <h2>Representative activity is not connected</h2>
            <p>
              {routesResult.ok
                ? visitsResult.ok
                  ? tasksResult.message
                  : visitsResult.message
                : routesResult.message}
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const routes = routesResult.ok ? routesResult.data.items : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const representatives = filterRepresentatives(
    buildRepresentativeSummaries(routes, visits, tasks),
    {
      activity: selectedActivity,
      search,
    },
  );
  const counters = buildRepresentativeCounters(representatives);
  const filterSummary = buildRepresentativeFilterSummary({
    activity: selectedActivity,
    search,
  });

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Representatives</h1>
          <p>
            Review field workload, recent activity and follow-up ownership from
            operational route, visit and task data.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            Overview
          </a>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/manager/locations`}
          >
            Coverage
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
            Tasks
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Representative metrics">
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
            <h2>Representative workload</h2>
            <p>Showing {filterSummary.toLowerCase()} for this tenant.</p>
          </div>
          <div
            className="filter-pills"
            aria-label="Representative activity filters"
          >
            <a
              aria-current={!selectedActivity ? "page" : undefined}
              href={buildRepresentativeFilterHref(tenantSlug, {
                activity: null,
                search,
              })}
            >
              All
            </a>
            {activityFilters.map((filter) => (
              <a
                aria-current={
                  selectedActivity === filter.value ? "page" : undefined
                }
                href={buildRepresentativeFilterHref(tenantSlug, {
                  activity: filter.value,
                  search,
                })}
                key={filter.value}
              >
                {filter.label}
              </a>
            ))}
          </div>
        </div>

        <form
          action={`/${tenantSlug}/manager/representatives`}
          className="filter-form representatives-filter-form"
        >
          {selectedActivity ? (
            <input name="activity" type="hidden" value={selectedActivity} />
          ) : null}
          <label>
            Search
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder="Name or email"
              type="search"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              Apply filters
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/representatives`}
              >
                Reset
              </a>
            ) : null}
          </div>
        </form>

        {representatives.length > 0 ? (
          <RepresentativesTable
            representatives={representatives}
            tenantSlug={tenantSlug}
          />
        ) : (
          <div className="empty-state-panel">
            <h2>No representatives match this filter</h2>
            <p>
              Use another activity filter or create route, visit or task
              activity before reviewing representative workload here.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/representatives`}
                >
                  Show all representatives
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

function RepresentativesTable({
  representatives,
  tenantSlug,
}: {
  representatives: RepresentativeSummary[];
  tenantSlug: string;
}) {
  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>Representative</th>
          <th>Routes</th>
          <th>Visits</th>
          <th>Open tasks</th>
          <th>Last activity</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {representatives.map((representative) => (
          <tr key={representative.id}>
            <td>
              <strong>{representative.name}</strong>
              <span>{representative.email}</span>
            </td>
            <td>{representative.routeCount}</td>
            <td>
              <strong>{representative.visitCount}</strong>
              <span>{representative.completedVisitCount} completed</span>
            </td>
            <td>
              <span
                className={`status-pill ${
                  representative.openTaskCount > 0 ? "warning" : "active"
                }`}
              >
                {representative.openTaskCount}
              </span>
            </td>
            <td>
              {formatDateTime(representative.lastActivityAt, "No activity")}
            </td>
            <td>
              <div className="table-actions">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/visits?representativeUserId=${representative.id}`}
                >
                  Visits
                </a>
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/tasks?assignedToUserId=${representative.id}`}
                >
                  Tasks
                </a>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildRepresentativeSummaries(
  routes: RoutePlan[],
  visits: Visit[],
  tasks: Task[],
): RepresentativeSummary[] {
  const summaries = new Map<string, RepresentativeSummary>();

  for (const route of routes) {
    const summary = getRepresentativeSummary(summaries, route.representative);
    summary.routeCount += 1;
    updateLastActivity(summary, route.updatedAt);
  }

  for (const visit of visits) {
    const summary = getRepresentativeSummary(summaries, visit.representative);
    summary.visitCount += 1;

    if (visit.status === "completed") {
      summary.completedVisitCount += 1;
    }

    updateLastActivity(
      summary,
      visit.completedAt ?? visit.startedAt ?? visit.updatedAt,
    );
  }

  for (const task of tasks) {
    if (!task.assignedTo) {
      continue;
    }

    const summary = getRepresentativeSummary(summaries, task.assignedTo);
    summary.taskCount += 1;

    if (task.status === "open" || task.status === "in_progress") {
      summary.openTaskCount += 1;
    }

    updateLastActivity(summary, task.updatedAt);
  }

  return [...summaries.values()].sort((a, b) => {
    const activityDifference =
      new Date(b.lastActivityAt ?? 0).getTime() -
      new Date(a.lastActivityAt ?? 0).getTime();

    return activityDifference || a.name.localeCompare(b.name);
  });
}

function getRepresentativeSummary(
  summaries: Map<string, RepresentativeSummary>,
  representative: { id: string; email: string; name: string },
): RepresentativeSummary {
  const existingSummary = summaries.get(representative.id);

  if (existingSummary) {
    return existingSummary;
  }

  const summary = {
    completedVisitCount: 0,
    email: representative.email,
    id: representative.id,
    lastActivityAt: null,
    name: representative.name,
    openTaskCount: 0,
    routeCount: 0,
    taskCount: 0,
    visitCount: 0,
  };
  summaries.set(representative.id, summary);

  return summary;
}

function updateLastActivity(
  summary: RepresentativeSummary,
  activityAt: string | null,
) {
  if (
    activityAt &&
    (!summary.lastActivityAt ||
      new Date(activityAt).getTime() >
        new Date(summary.lastActivityAt).getTime())
  ) {
    summary.lastActivityAt = activityAt;
  }
}

function filterRepresentatives(
  representatives: RepresentativeSummary[],
  filters: {
    activity: RepresentativeActivityFilter | null;
    search: string | null;
  },
): RepresentativeSummary[] {
  const normalizedSearch = filters.search?.toLowerCase();

  return representatives.filter((representative) => {
    const matchesSearch =
      !normalizedSearch ||
      representative.name.toLowerCase().includes(normalizedSearch) ||
      representative.email.toLowerCase().includes(normalizedSearch);
    const matchesActivity =
      !filters.activity ||
      (filters.activity === "has_visits" && representative.visitCount > 0) ||
      (filters.activity === "open_tasks" && representative.openTaskCount > 0) ||
      (filters.activity === "no_activity" &&
        representative.visitCount === 0 &&
        representative.openTaskCount === 0);

    return matchesSearch && matchesActivity;
  });
}

function buildRepresentativeCounters(
  representatives: RepresentativeSummary[],
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const withVisits = representatives.filter(
    (representative) => representative.visitCount > 0,
  );
  const withOpenTasks = representatives.filter(
    (representative) => representative.openTaskCount > 0,
  );
  const withoutRecentActivity = representatives.filter(
    (representative) =>
      representative.visitCount === 0 && representative.openTaskCount === 0,
  );

  return [
    {
      label: "Visible reps",
      value: String(representatives.length),
      detail: "Representatives found in routes, visits or tasks",
      tone: representatives.length > 0 ? "active" : "info",
    },
    {
      label: "With visits",
      value: String(withVisits.length),
      detail: `${withoutRecentActivity.length} without visit or open task activity`,
      tone: withVisits.length > 0 ? "active" : "info",
    },
    {
      label: "Open follow-ups",
      value: String(withOpenTasks.length),
      detail: "Representatives owning open tasks",
      tone: withOpenTasks.length > 0 ? "warning" : "active",
    },
  ];
}

function buildRepresentativeFilterHref(
  tenantSlug: string,
  filters: {
    activity: RepresentativeActivityFilter | null;
    search: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (filters.activity) {
    query.set("activity", filters.activity);
  }

  if (filters.search) {
    query.set("search", filters.search);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/representatives${suffix ? `?${suffix}` : ""}`;
}

function buildRepresentativeFilterSummary(filters: {
  activity: RepresentativeActivityFilter | null;
  search: string | null;
}): string {
  const parts = [
    filters.activity
      ? formatActivityFilter(filters.activity)
      : "All representatives",
    filters.search ? `matching "${filters.search}"` : null,
  ].filter(Boolean);

  return parts.join(", ");
}

function normalizeActivityFilter(
  value: string | undefined,
): RepresentativeActivityFilter | null {
  if (
    value === "has_visits" ||
    value === "open_tasks" ||
    value === "no_activity"
  ) {
    return value;
  }

  return null;
}

function formatActivityFilter(value: RepresentativeActivityFilter): string {
  return (
    activityFilters.find((filter) => filter.value === value)?.label ?? value
  );
}
