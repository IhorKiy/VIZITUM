import { redirect } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { PendingSubmitButton } from "../../../components/pending-submit-button";
import {
  createTask,
  listHighPriorityTasks,
  listLocations,
  listTasks,
  listTodayRoutes,
  listVisits,
  recordDashboardView,
  type Location,
  type RoutePlan,
  type Task,
  type Visit,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

type ManagerPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    task?: string;
    error?: string;
  }>;
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

type TaskAssigneeOption = {
  id: string;
  label: string;
};

type TaskLocationOption = {
  id: string;
  label: string;
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

export default async function ManagerPage({
  params,
  searchParams,
}: ManagerPageProps) {
  const { tenantSlug } = await params;
  const { task, error } = await searchParams;

  await recordDashboardView("manager").catch(() => undefined);

  async function createManagerTaskAction(formData: FormData) {
    "use server";

    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const priority = parseTaskPriorityInput(formData.get("priority"));
    const assignedToUserId = String(
      formData.get("assignedToUserId") ?? "",
    ).trim();
    const locationId = String(formData.get("locationId") ?? "").trim();
    const dueDate = String(formData.get("dueDate") ?? "").trim();

    if (!title) {
      redirect(`/${tenantSlug}/manager?error=task`);
    }

    const result = await createTask({
      title,
      priority,
      ...(description ? { description } : {}),
      ...(assignedToUserId ? { assignedToUserId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(dueDate ? { dueDate } : {}),
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/manager?error=task`);
    }

    redirect(`/${tenantSlug}/manager?task=created`);
  }

  const [
    routesResult,
    visitsResult,
    tasksResult,
    highPriorityTasksResult,
    locationsResult,
  ] = await Promise.all([
    listTodayRoutes(),
    listVisits(),
    listTasks(),
    listHighPriorityTasks(),
    listLocations(),
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
      <AppShell tenantSlug={tenantSlug} activeArea="manager-overview">
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
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const metrics = hasLiveData
    ? buildLiveMetrics(routes, visits, tasks, highPriorityTasks)
    : demoMetrics;
  const representatives = hasLiveData
    ? buildRepresentativeSummaries(routes, visits)
    : demoRepresentatives;
  const attentionItems =
    hasLiveData && (routes.length > 0 || tasks.length > 0)
      ? buildAttentionItems(routes, tasks)
      : demoAttentionItems;
  const assigneeOptions = buildTaskAssigneeOptions(routes, visits, tasks);
  const locationOptions = buildTaskLocationOptions(routes, visits, locations);
  const managerCsv = buildManagerCsv(metrics, representatives, attentionItems);

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-overview">
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
          <a
            className="secondary-button"
            download="vizitum-manager-dashboard.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
              managerCsv,
            )}`}
          >
            Export
          </a>
          <a className="primary-button" href="#assign-task">
            Assign task
          </a>
        </div>
      </header>

      {task === "created" ? (
        <section className="notice-panel success" aria-label="Task status">
          <div>
            <p className="eyebrow">Task assigned</p>
            <h2>Task created</h2>
            <p>The new task is now visible in the team task queue.</p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#assign-task">
              Assign another
            </a>
            <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
              Open task list
            </a>
          </div>
        </section>
      ) : null}

      {error === "task" ? (
        <section className="notice-panel danger" aria-label="Task error">
          <div>
            <p className="eyebrow">Task not assigned</p>
            <h2>Create task failed</h2>
            <p>
              Add a task title, keep optional assignee/location fields blank if
              they are not ready and try again.
            </p>
          </div>
          <div className="notice-actions">
            <a className="primary-button" href="#assign-task">
              Return to task form
            </a>
          </div>
        </section>
      ) : null}

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
          {representatives.length > 0 ? (
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
          ) : (
            <p className="empty-state">
              No active route plans are visible for today. Use the task form to
              assign follow-up work or import an initial visit plan.
            </p>
          )}
        </div>

        <div className="panel">
          <h2>Attention queue</h2>
          <div className="field-stack">
            {attentionItems.map((item, index) => (
              <article
                className="visit-card"
                key={`${item.area}-${item.title}-${index}`}
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

        <div className="panel" id="assign-task">
          <h2>Assign task</h2>
          <form action={createManagerTaskAction} className="visit-form compact">
            <label>
              Title
              <textarea
                name="title"
                placeholder="Follow up with location or representative"
                required
                rows={2}
              />
            </label>
            <label>
              Details
              <textarea
                name="description"
                placeholder="Optional context for the assignee"
                rows={3}
              />
            </label>
            <label>
              Assignee
              <select name="assignedToUserId">
                <option value="">Unassigned</option>
                {assigneeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {assigneeOptions.length === 0 ? (
                <span className="form-hint">
                  Add users or create field activity to populate assignees.
                </span>
              ) : null}
            </label>
            <label>
              Location
              <select name="locationId">
                <option value="">No location</option>
                {locationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {locationOptions.length === 0 ? (
                <span className="form-hint">
                  Import or create active locations to link tasks to places.
                </span>
              ) : null}
            </label>
            <div className="form-row">
              <label>
                Priority
                <select name="priority" defaultValue="normal" required>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                Due date
                <input name="dueDate" type="date" />
              </label>
            </div>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Creating..."
            >
              Create task
            </PendingSubmitButton>
          </form>
        </div>
      </section>
    </AppShell>
  );
}

function buildLiveMetrics(
  routes: RoutePlan[],
  visits: Visit[],
  tasks: Task[],
  highPriorityTasks: Task[],
): ManagerMetric[] {
  const totalRouteItems = routes.reduce(
    (sum, route) => sum + route.items.length,
    0,
  );
  const completedRouteItems = routes.reduce(
    (sum, route) =>
      sum + route.items.filter((item) => item.status === "visited").length,
    0,
  );
  const confirmedVisits = visits.filter(
    (visit) => visit.status === "completed",
  ).length;
  const openHighPriorityTasks = highPriorityTasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  ).length;
  const openTasks = tasks.filter(
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
      value: String(openTasks),
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
        .filter((item) => item.status !== "visited")
        .map((item) => ({
          route,
          item,
        })),
    )
    .slice(0, 2);
  const urgentTasks = tasks
    .filter(
      (task) =>
        task.priority === "high" &&
        task.status !== "done" &&
        task.status !== "cancelled",
    )
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

function buildTaskAssigneeOptions(
  routes: RoutePlan[],
  visits: Visit[],
  tasks: Task[],
): TaskAssigneeOption[] {
  const options = new Map<string, TaskAssigneeOption>();

  routes.forEach((route) => {
    options.set(route.representative.id, {
      id: route.representative.id,
      label: route.representative.name,
    });
  });
  visits.forEach((visit) => {
    options.set(visit.representative.id, {
      id: visit.representative.id,
      label: visit.representative.name,
    });
  });
  tasks.forEach((task) => {
    if (task.assignedTo) {
      options.set(task.assignedTo.id, {
        id: task.assignedTo.id,
        label: task.assignedTo.name,
      });
    }
  });

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildTaskLocationOptions(
  routes: RoutePlan[],
  visits: Visit[],
  locations: Location[],
): TaskLocationOption[] {
  const options = new Map<string, TaskLocationOption>();

  routes.forEach((route) => {
    route.items.forEach((item) => {
      options.set(item.location.id, {
        id: item.location.id,
        label: item.location.name,
      });
    });
  });
  visits.forEach((visit) => {
    options.set(visit.location.id, {
      id: visit.location.id,
      label: visit.location.name,
    });
  });
  locations.forEach((location) => {
    options.set(location.id, {
      id: location.id,
      label: location.name,
    });
  });

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function buildManagerCsv(
  metrics: ManagerMetric[],
  representatives: RepresentativeSummary[],
  attentionItems: AttentionItem[],
): string {
  return [
    ["Section", "Name", "Value", "Detail"],
    ...metrics.map((metric) => [
      "Metric",
      metric.label,
      metric.value,
      metric.detail,
    ]),
    ...representatives.map((representative) => [
      "Representative",
      representative.name,
      representative.route,
      representative.reports,
    ]),
    ...attentionItems.map((item) => [
      "Attention",
      item.title,
      item.area,
      item.detail,
    ]),
  ]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

function escapeCsvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseTaskPriorityInput(value: FormDataEntryValue | null) {
  return value === "low" || value === "normal" || value === "high"
    ? value
    : "normal";
}

function formatRouteStatus(status: RoutePlan["status"]): string {
  return status
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
