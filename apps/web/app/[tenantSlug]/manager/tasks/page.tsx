import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listAdminLocations,
  listTodayRoutes,
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../../lib/api-client";
import {
  buildLocationOptions,
  buildRouteOptions,
  type FilterOption,
} from "../../../../lib/filter-options";
import { formatEnumLabel, type CommonTranslator } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";

type ManagerTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    assignedToUserId?: string;
    dueFrom?: string;
    dueTo?: string;
    error?: string;
    locationId?: string;
    priority?: string;
    routePlanId?: string;
    status?: string;
    updated?: string;
  }>;
};

const taskStatuses: TaskStatus[] = ["open", "in_progress", "done", "cancelled"];
const taskPriorities: TaskPriority[] = ["high", "normal", "low"];

export default async function ManagerTasksPage({
  params,
  searchParams,
}: ManagerTasksPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [locale, t, tManager, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("manager.tasks"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
  const selectedStatus = normalizeTaskStatus(pageState.status);
  const selectedPriority = normalizeTaskPriority(pageState.priority);
  const selectedAssigneeId = normalizeFilterValue(pageState.assignedToUserId);
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const selectedRoutePlanId = normalizeFilterValue(pageState.routePlanId);
  const dueFrom = normalizeDateFilter(pageState.dueFrom);
  const dueTo = normalizeDateFilter(pageState.dueTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedPriority ||
    selectedAssigneeId ||
    selectedLocationId ||
    selectedRoutePlanId ||
    dueFrom ||
    dueTo,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedPriority) {
    query.set("priority", selectedPriority);
  }

  if (selectedAssigneeId) {
    query.set("assignedToUserId", selectedAssigneeId);
  }

  if (selectedLocationId) {
    query.set("locationId", selectedLocationId);
  }

  if (selectedRoutePlanId) {
    query.set("routePlanId", selectedRoutePlanId);
  }

  if (dueFrom) {
    query.set("dueFrom", dueFrom);
  }

  if (dueTo) {
    query.set("dueTo", dueTo);
  }

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();
    const status = normalizeTaskStatus(getFormString(formData, "status"));

    if (!taskId || !status) {
      redirect(`/${tenantSlug}/manager/tasks?error=update`);
    }

    const result = await updateTask(taskId, { status });

    if (!result.ok) {
      redirect(`/${tenantSlug}/manager/tasks?error=update`);
    }

    redirect(`/${tenantSlug}/manager/tasks?updated=1`);
  }

  const tasksResult = await listTasks(query.toString());
  const allTasksResult = hasFilters
    ? await listTasks("pageSize=100")
    : tasksResult;
  const routesResult = await listTodayRoutes();
  const locationsResult = await listAdminLocations("pageSize=100");

  if (!tasksResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-tasks">
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
            <p>{tasksResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const tasks = tasksResult.data.items;
  const counters = buildTaskCounters(tasks, tasksResult.data.total, t);
  const assigneeOptions = allTasksResult.ok
    ? buildAssigneeOptions(allTasksResult.data.items, locale)
    : [];
  const locationOptions = locationsResult.ok
    ? buildLocationOptions(locationsResult.data.items, locale)
    : [];
  const routeOptions = routesResult.ok
    ? buildRouteOptions(routesResult.data, locale)
    : [];
  const selectedAssigneeLabel =
    assigneeOptions.find((option) => option.id === selectedAssigneeId)?.label ??
    null;
  const selectedRouteLabel =
    routeOptions.find((option) => option.id === selectedRoutePlanId)?.label ??
    null;
  const selectedLocationLabel =
    locationOptions.find((option) => option.id === selectedLocationId)?.label ??
    null;
  const filterSummary = buildTaskFilterSummary(
    {
      assigneeLabel: selectedAssigneeLabel,
      dueFrom,
      dueTo,
      locationLabel: selectedLocationLabel,
      priority: selectedPriority,
      routeLabel: selectedRouteLabel,
      status: selectedStatus,
    },
    t,
    tCommon,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-tasks">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            {t("overview")}
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/visits`}>
            {t("visits")}
          </a>
        </div>
      </header>

      {pageState.updated ? (
        <section className="notice-panel success" aria-label={t("updateAria")}>
          <div>
            <p className="eyebrow">{t("updatedEyebrow")}</p>
            <h2>{t("updatedTitle")}</h2>
            <p>{t("updatedBody")}</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label={t("errorAria")}>
          <div>
            <p className="eyebrow">{t("errorEyebrow")}</p>
            <h2>{t("errorTitle")}</h2>
            <p>{t("errorBody")}</p>
          </div>
        </section>
      ) : null}

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
            <h2>{t("taskList")}</h2>
            <p>{t("showingSummary", { summary: filterSummary })}</p>
          </div>
          <div className="filter-groups">
            <div className="filter-pills" aria-label={t("statusFiltersAria")}>
              <a
                aria-current={!selectedStatus ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, {
                  assignedToUserId: selectedAssigneeId,
                  dueFrom,
                  dueTo,
                  locationId: selectedLocationId,
                  priority: selectedPriority,
                  routePlanId: selectedRoutePlanId,
                  status: null,
                })}
              >
                {tCommon("all")}
              </a>
              {taskStatuses.map((status) => (
                <a
                  aria-current={selectedStatus === status ? "page" : undefined}
                  href={buildTaskFilterHref(tenantSlug, {
                    assignedToUserId: selectedAssigneeId,
                    dueFrom,
                    dueTo,
                    locationId: selectedLocationId,
                    priority: selectedPriority,
                    routePlanId: selectedRoutePlanId,
                    status,
                  })}
                  key={status}
                >
                  {formatEnumLabel(tCommon, status)}
                </a>
              ))}
            </div>
            <div className="filter-pills" aria-label={t("priorityFiltersAria")}>
              <a
                aria-current={!selectedPriority ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, {
                  assignedToUserId: selectedAssigneeId,
                  dueFrom,
                  dueTo,
                  locationId: selectedLocationId,
                  priority: null,
                  routePlanId: selectedRoutePlanId,
                  status: selectedStatus,
                })}
              >
                {t("anyPriority")}
              </a>
              {taskPriorities.map((priority) => (
                <a
                  aria-current={
                    selectedPriority === priority ? "page" : undefined
                  }
                  href={buildTaskFilterHref(tenantSlug, {
                    assignedToUserId: selectedAssigneeId,
                    dueFrom,
                    dueTo,
                    locationId: selectedLocationId,
                    priority,
                    routePlanId: selectedRoutePlanId,
                    status: selectedStatus,
                  })}
                  key={priority}
                >
                  {formatEnumLabel(tCommon, priority)}
                </a>
              ))}
            </div>
          </div>
        </div>

        <form action={`/${tenantSlug}/manager/tasks`} className="filter-form">
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          {selectedPriority ? (
            <input name="priority" type="hidden" value={selectedPriority} />
          ) : null}
          <label>
            {t("route")}
            <select defaultValue={selectedRoutePlanId ?? ""} name="routePlanId">
              <option value="">{t("anyRoute")}</option>
              {routeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("location")}
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
            {t("assignee")}
            <select
              defaultValue={selectedAssigneeId ?? ""}
              name="assignedToUserId"
            >
              <option value="">{t("anyAssignee")}</option>
              {assigneeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("dueFrom")}
            <input defaultValue={dueFrom ?? ""} name="dueFrom" type="date" />
          </label>
          <label>
            {t("dueTo")}
            <input defaultValue={dueTo ?? ""} name="dueTo" type="date" />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              {tCommon("applyFilters")}
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/tasks`}
              >
                {tCommon("reset")}
              </a>
            ) : null}
          </div>
        </form>

        {tasks.length > 0 ? (
          <TasksTable
            tasks={tasks}
            updateTaskStatusAction={updateTaskStatusAction}
          />
        ) : (
          <div className="empty-state-panel">
            <h2>{t("emptyTitle")}</h2>
            <p>{t("emptyBody")}</p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/tasks`}
                >
                  {t("showAllTasks")}
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/manager`}>
                {t("assignTask")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function buildAssigneeOptions(tasks: Task[], locale: string): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const task of tasks) {
    if (!task.assignedTo) {
      continue;
    }

    options.set(task.assignedTo.id, {
      id: task.assignedTo.id,
      label: task.assignedTo.name,
    });
  }

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

function TasksTable({
  tasks,
  updateTaskStatusAction,
}: {
  tasks: Task[];
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <table className="table drilldown-table stacked-table">
      <thead>
        <tr>
          <th>{t("tableTask")}</th>
          <th>{t("tableLocation")}</th>
          <th>{t("tableAssignee")}</th>
          <th>{t("tableStatus")}</th>
          <th>{t("tablePriority")}</th>
          <th>{t("tableDue")}</th>
          <th>{t("tableUpdate")}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td data-label={t("tableTask")}>
              <strong>{task.title}</strong>
              <span>{task.description ?? t("noTaskDetails")}</span>
            </td>
            <td data-label={t("tableLocation")}>
              {task.location ? (
                <>
                  <strong>{task.location.name}</strong>
                  <span>{task.location.city}</span>
                </>
              ) : (
                t("noLocation")
              )}
            </td>
            <td data-label={t("tableAssignee")}>
              {task.assignedTo?.name ?? t("unassigned")}
            </td>
            <td data-label={t("tableStatus")}>
              <span className={`status-pill ${taskStatusTone(task.status)}`}>
                {formatEnumLabel(tCommon, task.status)}
              </span>
            </td>
            <td data-label={t("tablePriority")}>
              {formatEnumLabel(tCommon, task.priority)}
            </td>
            <td className="nowrap-cell" data-label={t("tableDue")}>
              {formatDate(format, task.dueDate)}
            </td>
            <td className="stacked-actions-cell" data-label={t("tableUpdate")}>
              <form
                action={updateTaskStatusAction}
                className="inline-control-form"
              >
                <input name="taskId" type="hidden" value={task.id} />
                <select
                  aria-label={t("updateTaskStatusAria", { title: task.title })}
                  defaultValue={task.status}
                  name="status"
                >
                  {taskStatuses.map((status) => (
                    <option key={status} value={status}>
                      {formatEnumLabel(tCommon, status)}
                    </option>
                  ))}
                </select>
                <PendingSubmitButton
                  className="secondary-button"
                  pendingLabel={tCommon("saving")}
                >
                  {tCommon("save")}
                </PendingSubmitButton>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type TasksTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.tasks">>
>;

function buildTaskCounters(
  tasks: Task[],
  total: number,
  t: TasksTranslator,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const open = tasks.filter(
    (task) => task.status === "open" || task.status === "in_progress",
  );
  const highPriority = open.filter((task) => task.priority === "high");
  const overdue = open.filter((task) => {
    if (!task.dueDate) {
      return false;
    }

    return new Date(task.dueDate).getTime() < startOfToday().getTime();
  });

  return [
    {
      label: t("visibleTasks"),
      value: String(total),
      detail: t("loadedOnPage", { count: tasks.length }),
      tone: "active",
    },
    {
      label: t("openWork"),
      value: String(open.length),
      detail: t("openWorkDetail", { count: highPriority.length }),
      tone: highPriority.length > 0 ? "warning" : "active",
    },
    {
      label: t("overdue"),
      value: String(overdue.length),
      detail: t("overdueDetail"),
      tone: overdue.length > 0 ? "warning" : "active",
    },
  ];
}

function buildTaskFilterHref(
  tenantSlug: string,
  filters: {
    assignedToUserId: string | null;
    dueFrom: string | null;
    dueTo: string | null;
    locationId: string | null;
    priority: TaskPriority | null;
    routePlanId: string | null;
    status: TaskStatus | null;
  },
): string {
  const query = new URLSearchParams();

  if (filters.status) {
    query.set("status", filters.status);
  }

  if (filters.priority) {
    query.set("priority", filters.priority);
  }

  if (filters.assignedToUserId) {
    query.set("assignedToUserId", filters.assignedToUserId);
  }

  if (filters.locationId) {
    query.set("locationId", filters.locationId);
  }

  if (filters.routePlanId) {
    query.set("routePlanId", filters.routePlanId);
  }

  if (filters.dueFrom) {
    query.set("dueFrom", filters.dueFrom);
  }

  if (filters.dueTo) {
    query.set("dueTo", filters.dueTo);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/tasks${suffix ? `?${suffix}` : ""}`;
}

function buildTaskFilterSummary(
  filters: {
    assigneeLabel: string | null;
    dueFrom: string | null;
    dueTo: string | null;
    locationLabel: string | null;
    priority: TaskPriority | null;
    routeLabel: string | null;
    status: TaskStatus | null;
  },
  t: TasksTranslator,
  tCommon: CommonTranslator,
): string {
  const parts = [
    filters.status
      ? t("summaryStatusTasks", {
          status: formatEnumLabel(tCommon, filters.status),
        })
      : t("summaryAllTasks"),
    filters.priority
      ? t("summaryPriority", {
          priority: formatEnumLabel(tCommon, filters.priority),
        })
      : null,
    filters.assigneeLabel
      ? t("summaryAssignedTo", { name: filters.assigneeLabel })
      : null,
    filters.locationLabel
      ? t("summaryAtLocation", { name: filters.locationLabel })
      : null,
    filters.routeLabel
      ? t("summaryOnRoute", { name: filters.routeLabel })
      : null,
    filters.dueFrom ? t("summaryFrom", { date: filters.dueFrom }) : null,
    filters.dueTo ? t("summaryTo", { date: filters.dueTo }) : null,
  ].filter(Boolean);

  return parts.join(", ");
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

function normalizeTaskStatus(value: string | undefined): TaskStatus | null {
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function normalizeTaskPriority(value: string | undefined): TaskPriority | null {
  if (value === "high" || value === "normal" || value === "low") {
    return value;
  }

  return null;
}

function taskStatusTone(status: TaskStatus): "active" | "info" | "warning" {
  if (status === "done") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}

function formatDate(
  format: ReturnType<typeof useFormatter>,
  value: string | null,
): string {
  if (!value) {
    return "-";
  }

  return format.dateTime(new Date(value), { dateStyle: "medium" });
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
}
