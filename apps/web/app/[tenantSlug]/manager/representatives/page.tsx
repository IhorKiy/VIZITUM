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
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { formatDateTime, normalizeFilterValue } from "../../../../lib/format";

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
  labelKey: "filterHasVisits" | "filterOpenTasks" | "filterNoActivity";
}> = [
  { value: "has_visits", labelKey: "filterHasVisits" },
  { value: "open_tasks", labelKey: "filterOpenTasks" },
  { value: "no_activity", labelKey: "filterNoActivity" },
];

type RepresentativesTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.representatives">>
>;

export default async function ManagerRepresentativesPage({
  params,
  searchParams,
}: ManagerRepresentativesPageProps) {
  const { tenantSlug } = await params;
  const [locale, t, tManager, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("manager.representatives"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("dashboard.manager.read")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
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
    buildRepresentativeSummaries(routes, visits, tasks, locale),
    {
      activity: selectedActivity,
      search,
    },
  );
  const counters = buildRepresentativeCounters(representatives, t);
  const filterSummary = buildRepresentativeFilterSummary(
    {
      activity: selectedActivity,
      search,
    },
    t,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            {t("overview")}
          </a>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/manager/locations`}
          >
            {t("coverage")}
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
            <h2>{t("workload")}</h2>
            <p>{t("showingSummary", { summary: filterSummary })}</p>
          </div>
          <div className="filter-pills" aria-label={t("activityFiltersAria")}>
            <a
              aria-current={!selectedActivity ? "page" : undefined}
              href={buildRepresentativeFilterHref(tenantSlug, {
                activity: null,
                search,
              })}
            >
              {tCommon("all")}
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
                {t(filter.labelKey)}
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
            {t("search")}
            <input
              defaultValue={search ?? ""}
              name="search"
              placeholder={t("searchPlaceholder")}
              type="search"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              {tCommon("applyFilters")}
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/representatives`}
              >
                {tCommon("reset")}
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
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/representatives`}
                >
                  {t("showAll")}
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

function RepresentativesTable({
  representatives,
  tenantSlug,
}: {
  representatives: RepresentativeSummary[];
  tenantSlug: string;
}) {
  const t = useTranslations("manager.representatives");
  const format = useFormatter();

  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>{t("tableRepresentative")}</th>
          <th>{t("tableRoutes")}</th>
          <th>{t("tableVisits")}</th>
          <th>{t("tableOpenTasks")}</th>
          <th>{t("tableLastActivity")}</th>
          <th>{t("tableActions")}</th>
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
              <span>
                {t("completedCount", {
                  count: representative.completedVisitCount,
                })}
              </span>
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
              {formatDateTime(
                format,
                representative.lastActivityAt,
                t("noActivity"),
              )}
            </td>
            <td>
              <div className="table-actions">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/visits?representativeUserId=${representative.id}`}
                >
                  {t("visits")}
                </a>
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/tasks?assignedToUserId=${representative.id}`}
                >
                  {t("tasks")}
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
  locale: string,
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

    return activityDifference || a.name.localeCompare(b.name, locale);
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
  t: RepresentativesTranslator,
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
      label: t("visibleReps"),
      value: String(representatives.length),
      detail: t("visibleRepsDetail"),
      tone: representatives.length > 0 ? "active" : "info",
    },
    {
      label: t("withVisits"),
      value: String(withVisits.length),
      detail: t("withVisitsDetail", { count: withoutRecentActivity.length }),
      tone: withVisits.length > 0 ? "active" : "info",
    },
    {
      label: t("openFollowUps"),
      value: String(withOpenTasks.length),
      detail: t("openFollowUpsDetail"),
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

function buildRepresentativeFilterSummary(
  filters: {
    activity: RepresentativeActivityFilter | null;
    search: string | null;
  },
  t: RepresentativesTranslator,
): string {
  const parts = [
    filters.activity
      ? formatActivityFilter(filters.activity, t)
      : t("summaryAll"),
    filters.search ? t("summaryMatching", { search: filters.search }) : null,
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

function formatActivityFilter(
  value: RepresentativeActivityFilter,
  t: RepresentativesTranslator,
): string {
  const filter = activityFilters.find((entry) => entry.value === value);

  return filter ? t(filter.labelKey) : value;
}
