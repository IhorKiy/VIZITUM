import { AppShell } from "../../../../../components/app-shell";
import { CardFact } from "../../../../../components/card-fact";
import { FilterDisclosure } from "../../../../../components/filter-disclosure";
import { FilterField } from "../../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../../components/filter-footer";
import { FilterForm } from "../../../../../components/filter-form";
import { FilterPills } from "../../../../../components/filter-pills";
import {
  CalendarIcon,
  CheckIcon,
  MailIcon,
  MapPinIcon,
  SearchIcon,
} from "../../../../../components/icons";
import {
  getCurrentSession,
  listRoutes,
  listTasks,
  listVisits,
  type RoutePlan,
  type Task,
  type Visit,
} from "../../../../../lib/api-client";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import {
  formatDateTime,
  normalizeFilterValue,
} from "../../../../../lib/format";
import { INPUT_LIMITS } from "../../../../../lib/input-limits";
import { isTaskUnfinished } from "../../../../../lib/task-status";

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
  // Each of these is one page, capped server-side at MAX_PAGE_SIZE (100, see
  // src/common/pagination.ts) whatever is asked for, and every per-rep figure
  // below is derived by grouping that one page client-side. So `routeCount`
  // and `lastActivityAt` describe the 100 most recent plans **across the whole
  // team**, not per representative: in a tenant where several reps plan daily
  // the window covers only the last few days and the counts read low. The
  // field planning screen carries the same ceiling for a single rep; here the
  // one window is split across the team, so the effect is proportionally
  // worse. Not a regression — until GET /routes stopped refusing a team-wide
  // caller these numbers did not load at all — but this is the first build
  // where a reader sees them. The real fix is the same one that screen names:
  // a server-side date-range filter on GET /routes, so this asks for a period
  // instead of a page.
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

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-representatives">
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

      <section aria-label={t("workload")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/manager/representatives`}>
          <div className="panel-toolbar">
            <FilterPills
              ariaLabel={t("activityFiltersAria")}
              name="activity"
              options={[
                { label: tCommon("all"), value: "" },
                ...activityFilters.map((filter) => ({
                  label: t(filter.labelKey),
                  value: filter.value,
                })),
              ]}
              value={selectedActivity ?? ""}
            />
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form representatives-filter-form">
              <FilterField icon={<SearchIcon />} label={t("search")}>
                <input
                  defaultValue={search ?? ""}
                  maxLength={INPUT_LIMITS.search}
                  name="search"
                  placeholder={t("searchPlaceholder")}
                  type="search"
                />
              </FilterField>
              <FilterFooter
                resetHref={
                  hasFilters
                    ? `/${tenantSlug}/manager/representatives`
                    : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: representatives.length,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {representatives.length > 0 ? (
          <RepresentativesCards
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

function RepresentativesCards({
  representatives,
  tenantSlug,
}: {
  representatives: RepresentativeSummary[];
  tenantSlug: string;
}) {
  const t = useTranslations("manager.representatives");
  const format = useFormatter();

  // The rep is the title, the open-task count sits top-right as the headline
  // pill (amber when work is pending), and the footer drills into that rep's
  // visits and tasks.
  return (
    <ul className="list-cards">
      {representatives.map((representative) => (
        <li className="list-card" key={representative.id}>
          <div className="list-card-top">
            <h3 className="list-card-title">{representative.name}</h3>
            <span
              className={`status-pill ${
                representative.openTaskCount > 0 ? "warning" : "active"
              }`}
              title={t("tableOpenTasks")}
            >
              <span className="sr-only">{t("tableOpenTasks")}: </span>
              {representative.openTaskCount}
            </span>
          </div>
          <dl className="list-card-facts">
            <CardFact icon={<MailIcon />} label={t("email")}>
              {representative.email}
            </CardFact>
            <CardFact icon={<MapPinIcon />} label={t("tableRoutes")}>
              {representative.routeCount}
            </CardFact>
            <CardFact icon={<CheckIcon />} label={t("tableVisits")}>
              {representative.visitCount} ·{" "}
              {t("completedCount", {
                count: representative.completedVisitCount,
              })}
            </CardFact>
            <CardFact icon={<CalendarIcon />} label={t("tableLastActivity")}>
              {formatDateTime(
                format,
                representative.lastActivityAt,
                t("noActivity"),
              )}
            </CardFact>
          </dl>
          <div className="list-card-links">
            <a
              className="list-card-open"
              href={`/${tenantSlug}/manager/visits?representativeUserId=${representative.id}`}
            >
              {t("visits")}
            </a>
            <a
              className="list-card-open"
              href={`/${tenantSlug}/manager/tasks?assignedToUserId=${representative.id}`}
            >
              {t("tasks")}
            </a>
          </div>
        </li>
      ))}
    </ul>
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

    if (isTaskUnfinished(task.status)) {
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
