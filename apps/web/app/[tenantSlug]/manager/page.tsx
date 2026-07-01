import { AppShell } from "../../../components/app-shell";
import {
  listHighPriorityTasks,
  listTasks,
  listTodayRoutes,
  listVisits,
  type RoutePlan,
  type Task,
  type Visit,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

type ManagerPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type ManagerMetric = {
  label: string;
  value: string;
  detail: string;
  isLive: boolean;
};

type RepresentativeSummary = {
  name: string;
  route: string;
  reports: string;
};

type AttentionItem = {
  title: string;
  tone: "info" | "warning";
  area: string;
  detail: string;
};

const demoMetrics: ManagerMetric[] = [
  {
    label: "Visits today",
    value: "42",
    detail: "7 remaining",
    isLive: false,
  },
  {
    label: "Reports confirmed",
    value: "31",
    detail: "4 AI drafts waiting",
    isLive: false,
  },
  {
    label: "Open tasks",
    value: "18",
    detail: "6 high priority",
    isLive: false,
  },
];

const demoRepresentatives: RepresentativeSummary[] = [
  { name: "Olena K.", route: "Kyiv North", reports: "8 / 10" },
  { name: "Andrii M.", route: "Kyiv Center", reports: "6 / 7" },
  { name: "Iryna S.", route: "Kyiv West", reports: "5 / 8" },
];

const demoAttentionItems: AttentionItem[] = [
  {
    title: "Late route item",
    tone: "warning",
    area: "Route",
    detail: "Pharmacy 24 has no confirmed report.",
  },
  {
    title: "Import needs fix",
    tone: "warning",
    area: "Admin",
    detail: "users-pilot.csv has 2 invalid rows.",
  },
];

export default async function ManagerPage({ params }: ManagerPageProps) {
  const { tenantSlug } = await params;
  const [routesResult, visitsResult, tasksResult, highPriorityTasksResult] =
    await Promise.all([
      listTodayRoutes(),
      listVisits(),
      listTasks(),
      listHighPriorityTasks(),
    ]);
  const hasLiveData =
    routesResult.ok &&
    visitsResult.ok &&
    tasksResult.ok &&
    highPriorityTasksResult.ok;
  const demoFallbackEnabled = isDemoFallbackEnabled();
  const apiFailureMessage = [
    routesResult,
    visitsResult,
    tasksResult,
    highPriorityTasksResult,
  ].find((result) => !result.ok)?.message;

  if (!hasLiveData && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Operations dashboard</h1>
            <p>
              Live route, visit and task metrics are required in production
              before manager review can continue.
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
            <h2>Manager metrics are not connected</h2>
            <p>{apiFailureMessage}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const routes = routesResult.ok ? routesResult.data : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const highPriorityTasks = highPriorityTasksResult.ok
    ? highPriorityTasksResult.data.items
    : [];
  const metrics = hasLiveData
    ? buildLiveMetrics(
        routes,
        visits,
        tasksResult.data.total,
        highPriorityTasks,
      )
    : demoMetrics;
  const representatives =
    hasLiveData && routes.length > 0
      ? buildRepresentativeSummaries(routes, visits)
      : demoRepresentatives;
  const attentionItems =
    hasLiveData && (routes.length > 0 || tasks.length > 0)
      ? buildAttentionItems(routes, tasks)
      : demoAttentionItems;
  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Operations dashboard</h1>
          <p>
            Track execution, review report readiness and focus the team on
            blocked work.
          </p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button">
            Export
          </button>
          <button className="primary-button" type="button">
            Assign task
          </button>
        </div>
      </header>

      {!hasLiveData && demoFallbackEnabled ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Manager metrics are not connected</h2>
            <p>
              Showing sample operations data until routes, visits and tasks API
              calls return authenticated responses. Reason: {apiFailureMessage}
            </p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Manager metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <header>
              <p className="metric-label">{metric.label}</p>
              <span className="status-pill info">
                {metric.isLive ? "Live" : "Demo"}
              </span>
            </header>
            <p className="metric-value">{metric.value}</p>
            <p className="small-label">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" aria-label="Manager worklists">
        <div className="panel">
          <h2>Representatives</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Route</th>
                <th>Reports</th>
              </tr>
            </thead>
            <tbody>
              {representatives.map((representative) => (
                <tr key={representative.name}>
                  <td>{representative.name}</td>
                  <td>{representative.route}</td>
                  <td>{representative.reports}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Attention queue</h2>
          <div className="field-stack">
            {attentionItems.map((item) => (
              <article
                className="visit-card"
                key={`${item.area}-${item.title}`}
              >
                <header>
                  <h2>{item.title}</h2>
                  <span className={`status-pill ${item.tone}`}>
                    {item.area}
                  </span>
                </header>
                <p className="visit-meta">{item.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function buildLiveMetrics(
  routes: RoutePlan[],
  visits: Visit[],
  totalTasks: number,
  highPriorityTasks: Task[],
): ManagerMetric[] {
  const totalRouteItems = routes.reduce(
    (sum, route) => sum + route.items.length,
    0,
  );
  const completedRouteItems = routes.reduce(
    (sum, route) =>
      sum + route.items.filter((item) => item.status === "completed").length,
    0,
  );
  const confirmedVisits = visits.filter(
    (visit) => visit.status === "completed",
  ).length;
  const openHighPriorityTasks = highPriorityTasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  ).length;

  return [
    {
      label: "Visits today",
      value: String(totalRouteItems),
      detail: `${Math.max(totalRouteItems - completedRouteItems, 0)} remaining`,
      isLive: true,
    },
    {
      label: "Reports confirmed",
      value: String(confirmedVisits),
      detail: `${Math.max(visits.length - confirmedVisits, 0)} waiting`,
      isLive: true,
    },
    {
      label: "Open tasks",
      value: String(totalTasks),
      detail: `${openHighPriorityTasks} high priority`,
      isLive: true,
    },
  ];
}

function buildRepresentativeSummaries(
  routes: RoutePlan[],
  visits: Visit[],
): RepresentativeSummary[] {
  return routes.map((route) => {
    const routeVisits = visits.filter(
      (visit) => visit.representativeUserId === route.representativeUserId,
    );
    const confirmedReports = routeVisits.filter(
      (visit) => visit.status === "completed",
    ).length;

    return {
      name: route.representative.name,
      route: `${route.planDate} · ${formatRouteStatus(route.status)}`,
      reports: `${confirmedReports} / ${Math.max(route.items.length, routeVisits.length)}`,
    };
  });
}

function buildAttentionItems(
  routes: RoutePlan[],
  tasks: Task[],
): AttentionItem[] {
  const blockedRouteItems = routes
    .flatMap((route) =>
      route.items
        .filter((item) => item.status !== "completed")
        .map((item) => ({
          route,
          item,
        })),
    )
    .slice(0, 2);
  const urgentTasks = tasks
    .filter((task) => task.priority === "high" && task.status !== "done")
    .slice(0, Math.max(3 - blockedRouteItems.length, 1));
  const items: AttentionItem[] = [
    ...blockedRouteItems.map(({ route, item }) => ({
      title: item.location.name,
      tone: "warning" as const,
      area: "Route",
      detail: `${route.representative.name} still needs to complete item ${item.sequence}.`,
    })),
    ...urgentTasks.map((task) => ({
      title: task.title,
      tone: "warning" as const,
      area: "Task",
      detail:
        task.assignedTo?.name ??
        task.description ??
        "High-priority task is waiting for assignment.",
    })),
  ];

  return items.length > 0
    ? items
    : [
        {
          title: "No blockers",
          tone: "info",
          area: "Ops",
          detail: "Routes and high-priority tasks are clear right now.",
        },
      ];
}

function formatRouteStatus(status: RoutePlan["status"]): string {
  return status
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
