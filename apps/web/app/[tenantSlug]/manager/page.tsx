import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

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
import { formatEnumLabel, type CommonTranslator } from "../../../lib/format";
import { getFormString } from "../../../lib/form";

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

type OverviewTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.overview">>
>;

function buildDemoMetrics(t: OverviewTranslator): ManagerMetric[] {
  return [
    {
      label: t("visitsToday"),
      value: "42",
      detail: t("remainingDetail", { count: 7 }),
      isLive: false,
    },
    {
      label: t("reportsConfirmed"),
      value: "31",
      detail: t("demoDraftsWaiting"),
      isLive: false,
    },
    {
      label: t("openTasks"),
      value: "18",
      detail: t("highPriorityDetail", { count: 6 }),
      isLive: false,
    },
  ];
}

const demoRepresentatives: RepresentativeSummary[] = [
  { name: "Olena K.", route: "Kyiv North", reports: "8 / 10" },
  { name: "Andrii M.", route: "Kyiv Center", reports: "6 / 7" },
  { name: "Iryna S.", route: "Kyiv West", reports: "5 / 8" },
];

function buildDemoAttentionItems(t: OverviewTranslator): AttentionItem[] {
  return [
    {
      title: t("demoAttention1Title"),
      tone: "warning",
      area: t("areaRoute"),
      detail: t("demoAttention1Detail"),
    },
    {
      title: t("demoAttention2Title"),
      tone: "warning",
      area: t("areaAdmin"),
      detail: t("demoAttention2Detail"),
    },
  ];
}

export default async function ManagerPage({
  params,
  searchParams,
}: ManagerPageProps) {
  const { tenantSlug } = await params;
  const { task, error } = await searchParams;
  const [locale, t, tManager, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("manager.overview"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);

  await recordDashboardView("manager").catch(() => undefined);

  async function createManagerTaskAction(formData: FormData) {
    "use server";

    const title = getFormString(formData, "title").trim();
    const description = getFormString(formData, "description").trim();
    const priority = parseTaskPriorityInput(formData.get("priority"));
    const assignedToUserId = getFormString(formData, "assignedToUserId").trim();
    const locationId = getFormString(formData, "locationId").trim();
    const dueDate = getFormString(formData, "dueDate").trim();

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
    ? buildLiveMetrics(routes, visits, tasks, highPriorityTasks, t)
    : buildDemoMetrics(t);
  const representatives = hasLiveData
    ? buildRepresentativeSummaries(routes, visits, tCommon)
    : demoRepresentatives;
  const attentionItems =
    hasLiveData && (routes.length > 0 || tasks.length > 0)
      ? buildAttentionItems(routes, tasks, t)
      : buildDemoAttentionItems(t);
  const assigneeOptions = buildTaskAssigneeOptions(
    routes,
    visits,
    tasks,
    locale,
  );
  const locationOptions = buildTaskLocationOptions(
    routes,
    visits,
    locations,
    locale,
  );
  const managerCsv = buildManagerCsv(
    metrics,
    representatives,
    attentionItems,
    t,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-overview">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <a
            className="secondary-button"
            download="vizitum-manager-dashboard.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
              managerCsv,
            )}`}
          >
            {t("export")}
          </a>
          <a className="primary-button" href="#assign-task">
            {t("assignTask")}
          </a>
        </div>
      </header>

      {task === "created" ? (
        <section
          className="notice-panel success"
          aria-label={t("taskStatusAria")}
        >
          <div>
            <p className="eyebrow">{t("taskCreatedEyebrow")}</p>
            <h2>{t("taskCreatedTitle")}</h2>
            <p>{t("taskCreatedBody")}</p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#assign-task">
              {t("assignAnother")}
            </a>
            <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
              {t("openTaskList")}
            </a>
          </div>
        </section>
      ) : null}

      {error === "task" ? (
        <section
          className="notice-panel danger"
          aria-label={t("taskErrorAria")}
        >
          <div>
            <p className="eyebrow">{t("taskErrorEyebrow")}</p>
            <h2>{t("taskErrorTitle")}</h2>
            <p>{t("taskErrorBody")}</p>
          </div>
          <div className="notice-actions">
            <a className="primary-button" href="#assign-task">
              {t("returnToTaskForm")}
            </a>
          </div>
        </section>
      ) : null}

      {!hasLiveData && demoFallbackEnabled ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{t("demoBody", { reason: apiFailureMessage ?? "" })}</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label={t("metricsAria")}>
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <header>
              <p className="metric-label">{metric.label}</p>
              <span className="status-pill info">
                {metric.isLive
                  ? formatEnumLabel(tCommon, "live")
                  : formatEnumLabel(tCommon, "demo")}
              </span>
            </header>
            <p className="metric-value">{metric.value}</p>
            <p className="small-label">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" aria-label={t("worklistsAria")}>
        <div className="panel">
          <h2>{t("representatives")}</h2>
          {representatives.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("tableName")}</th>
                  <th>{t("tableRoute")}</th>
                  <th>{t("tableReports")}</th>
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
            <p className="empty-state">{t("noRoutes")}</p>
          )}
        </div>

        <div className="panel">
          <h2>{t("attentionQueue")}</h2>
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
          <h2>{t("assignTask")}</h2>
          <form action={createManagerTaskAction} className="visit-form compact">
            <label>
              {t("formTitle")}
              <textarea
                name="title"
                placeholder={t("formTitlePlaceholder")}
                required
                rows={2}
              />
            </label>
            <label>
              {t("formDetails")}
              <textarea
                name="description"
                placeholder={t("formDetailsPlaceholder")}
                rows={3}
              />
            </label>
            <label>
              {t("formAssignee")}
              <select name="assignedToUserId">
                <option value="">{t("formUnassigned")}</option>
                {assigneeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {assigneeOptions.length === 0 ? (
                <span className="form-hint">{t("formAssigneeHint")}</span>
              ) : null}
            </label>
            <label>
              {t("formLocation")}
              <select name="locationId">
                <option value="">{t("formNoLocation")}</option>
                {locationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {locationOptions.length === 0 ? (
                <span className="form-hint">{t("formLocationHint")}</span>
              ) : null}
            </label>
            <div className="form-row">
              <label>
                {t("formPriority")}
                <select name="priority" defaultValue="normal" required>
                  <option value="normal">
                    {formatEnumLabel(tCommon, "normal")}
                  </option>
                  <option value="high">
                    {formatEnumLabel(tCommon, "high")}
                  </option>
                  <option value="low">{formatEnumLabel(tCommon, "low")}</option>
                </select>
              </label>
              <label>
                {t("formDueDate")}
                <input name="dueDate" type="date" />
              </label>
            </div>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("creating")}
            >
              {t("createTask")}
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
  t: OverviewTranslator,
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
      label: t("visitsToday"),
      value: String(totalRouteItems),
      detail: t("remainingDetail", {
        count: Math.max(totalRouteItems - completedRouteItems, 0),
      }),
      isLive: true,
    },
    {
      label: t("reportsConfirmed"),
      value: String(confirmedVisits),
      detail: t("waitingDetail", {
        count: Math.max(visits.length - confirmedVisits, 0),
      }),
      isLive: true,
    },
    {
      label: t("openTasks"),
      value: String(openTasks),
      detail: t("highPriorityDetail", { count: openHighPriorityTasks }),
      isLive: true,
    },
  ];
}

function buildRepresentativeSummaries(
  routes: RoutePlan[],
  visits: Visit[],
  tCommon: CommonTranslator,
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
      route: `${route.planDate} · ${formatEnumLabel(tCommon, route.status)}`,
      reports: `${confirmedReports} / ${Math.max(route.items.length, routeVisits.length)}`,
    };
  });
}

function buildAttentionItems(
  routes: RoutePlan[],
  tasks: Task[],
  t: OverviewTranslator,
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
      area: t("areaRoute"),
      detail: t("routeAttentionDetail", {
        name: route.representative.name,
        sequence: item.sequence,
      }),
    })),
    ...urgentTasks.map((task) => ({
      title: task.title,
      tone: "warning" as const,
      area: t("areaTask"),
      detail:
        task.assignedTo?.name ?? task.description ?? t("taskAttentionFallback"),
    })),
  ];

  return items.length > 0
    ? items
    : [
        {
          title: t("noBlockersTitle"),
          tone: "info",
          area: t("areaOps"),
          detail: t("noBlockersDetail"),
        },
      ];
}

function buildTaskAssigneeOptions(
  routes: RoutePlan[],
  visits: Visit[],
  tasks: Task[],
  locale: string,
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

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

function buildTaskLocationOptions(
  routes: RoutePlan[],
  visits: Visit[],
  locations: Location[],
  locale: string,
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

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

function buildManagerCsv(
  metrics: ManagerMetric[],
  representatives: RepresentativeSummary[],
  attentionItems: AttentionItem[],
  t: OverviewTranslator,
): string {
  return [
    [t("csvSection"), t("csvName"), t("csvValue"), t("csvDetail")],
    ...metrics.map((metric) => [
      t("csvMetric"),
      metric.label,
      metric.value,
      metric.detail,
    ]),
    ...representatives.map((representative) => [
      t("csvRepresentative"),
      representative.name,
      representative.route,
      representative.reports,
    ]),
    ...attentionItems.map((item) => [
      t("csvAttention"),
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
