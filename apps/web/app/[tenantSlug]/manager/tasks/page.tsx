import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  AssignTaskModal,
  type AssignTaskActionResult,
} from "../../../../components/assign-task-modal";
import { CardFact } from "../../../../components/card-fact";
import { DeleteTaskButton } from "../../../../components/delete-task-button";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { FilterDateRange } from "../../../../components/filter-date-range";
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
  MapPinIcon,
  RouteIcon,
  UserIcon,
} from "../../../../components/icons";
import { TaskDetailsEditor } from "../../../../components/task-details-editor";
import { TaskStatusEditor } from "../../../../components/task-status-editor";
import {
  createTask,
  deleteTask,
  getCurrentSession,
  listAdminLocations,
  listTodayRoutes,
  listTasks,
  listVisits,
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
import { formatEnumLabel, type IntlFormatter } from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import {
  buildTaskAssigneeOptions,
  buildTaskLocationOptions,
  parseTaskPriorityInput,
} from "../../../../lib/task-form";
import { taskStatuses } from "../../../../lib/task-status";

type ManagerTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    assign?: string;
    assignedToUserId?: string;
    deleted?: string;
    dueFrom?: string;
    dueTo?: string;
    error?: string;
    locationId?: string;
    priority?: string;
    routePlanId?: string;
    status?: string;
    task?: string;
    updated?: string;
  }>;
};

const taskPriorities: TaskPriority[] = ["high", "normal", "low"];

export default async function ManagerTasksPage({
  params,
  searchParams,
}: ManagerTasksPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  // The assign-task form and its notices live in the overview namespace, where
  // the shared modal reads them from — the same strings, translated once.
  const [locale, timeZone, t, tManager, tOverview, tCommon] = await Promise.all(
    [
      getLocale(),
      getTimeZone(),
      getTranslations("manager.tasks"),
      getTranslations("manager"),
      getTranslations("manager.overview"),
      getTranslations("common"),
    ],
  );
  // Due dates are date-only "YYYY-MM-DD" strings; "overdue" must be judged
  // against today's date in the tenant timezone (the same zone the formatted
  // dates render in), not the server's local midnight.
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );
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

  async function createTaskAction(
    formData: FormData,
  ): Promise<AssignTaskActionResult> {
    "use server";

    const title = getFormString(formData, "title").trim();
    const description = getFormString(formData, "description").trim();
    const priority = parseTaskPriorityInput(formData.get("priority"));
    const assignedToUserId = getFormString(formData, "assignedToUserId").trim();
    const locationId = getFormString(formData, "locationId").trim();
    const dueDate = getFormString(formData, "dueDate").trim();

    // Failures return instead of redirecting: a redirect would remount the
    // page tree and throw away everything typed into the assign-task modal.
    if (!title) {
      return { ok: false };
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
      return { ok: false };
    }

    // Drops any active filter: the new task is the thing to look at, and it may
    // well not match the filter that was on screen when it was created.
    redirect(`/${tenantSlug}/manager/tasks?task=created`);
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

  async function updateTaskDetailsAction(formData: FormData) {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(`/${tenantSlug}/manager/tasks?error=update`);
    }

    const description = getFormString(formData, "description").trim();
    const result = await updateTask(taskId, {
      description: description || null,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/manager/tasks?error=update`);
    }

    redirect(`/${tenantSlug}/manager/tasks?updated=1`);
  }

  async function deleteTaskAction(formData: FormData) {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(`/${tenantSlug}/manager/tasks?error=delete`);
    }

    const result = await deleteTask(taskId);

    if (!result.ok) {
      redirect(`/${tenantSlug}/manager/tasks?error=delete`);
    }

    redirect(`/${tenantSlug}/manager/tasks?deleted=1`);
  }

  const tasksPromise = listTasks(query.toString());
  const [
    tasksResult,
    allTasksResult,
    routesResult,
    locationsResult,
    visitsResult,
    sessionResult,
  ] = await Promise.all([
    tasksPromise,
    hasFilters ? listTasks("pageSize=100") : tasksPromise,
    listTodayRoutes(),
    listAdminLocations("pageSize=100"),
    // Only feeds the assign form: a representative with a visit but no route
    // today and no task yet would otherwise be unassignable here.
    listVisits(),
    getCurrentSession(),
  ]);

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
  // Deleting needs team scope, which an own-scope viewer on this page lacks —
  // showing them a button that can only 403 is worse than not showing it.
  const canDeleteTasks = sessionResult.ok
    ? sessionResult.data.permissions.includes("tasks.update_team")
    : false;
  const counters = buildTaskCounters(
    tasks,
    tasksResult.data.total,
    t,
    todayIsoDate,
  );
  const assigneeOptions = allTasksResult.ok
    ? buildAssigneeOptions(allTasksResult.data.items, locale)
    : [];
  const locationOptions = locationsResult.ok
    ? buildLocationOptions(locationsResult.data.items, locale)
    : [];
  const routeOptions = routesResult.ok
    ? buildRouteOptions(routesResult.data, locale)
    : [];
  const routes = routesResult.ok ? routesResult.data : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  // The filter lists exist to narrow what is already here, so they follow the
  // tasks on screen; the assign form has to offer everyone who could take new
  // work and every place that is still open for it.
  const assignAssigneeOptions = buildTaskAssigneeOptions(
    routes,
    visits,
    allTasksResult.ok ? allTasksResult.data.items : tasks,
    locale,
  );
  const assignLocationOptions = buildTaskLocationOptions(
    routes,
    visits,
    locationsResult.ok
      ? locationsResult.data.items.filter(
          (location) => location.status === "active",
        )
      : [],
    locale,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-tasks">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <AssignTaskModal
            action={createTaskAction}
            assigneeOptions={assignAssigneeOptions}
            locationOptions={assignLocationOptions}
          />
        </div>
      </header>

      {pageState.task === "created" ? (
        <DismissableNotice
          actions={
            <a
              className="secondary-button"
              href={`/${tenantSlug}/manager/tasks?assign=1`}
            >
              {tOverview("assignAnother")}
            </a>
          }
          ariaLabel={tOverview("taskStatusAria")}
          body={tOverview("taskCreatedBody")}
          clearParams={["task"]}
          eyebrow={tOverview("taskCreatedEyebrow")}
          title={tOverview("taskCreatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.updated ? (
        <DismissableNotice
          ariaLabel={t("updateAria")}
          body={t("updatedBody")}
          clearParams={["updated"]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.deleted ? (
        <DismissableNotice
          ariaLabel={t("updateAria")}
          body={t("deletedBody")}
          clearParams={["deleted"]}
          eyebrow={t("deletedEyebrow")}
          title={t("deletedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={
            pageState.error === "delete" ? t("deleteErrorBody") : t("errorBody")
          }
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={
            pageState.error === "delete"
              ? t("deleteErrorTitle")
              : t("errorTitle")
          }
          tone="danger"
        />
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

      <section aria-label={t("taskList")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/manager/tasks`}>
          <div className="panel-toolbar">
            <div className="filter-groups">
              <FilterPills
                ariaLabel={t("statusFiltersAria")}
                name="status"
                options={[
                  { label: tCommon("all"), value: "" },
                  ...taskStatuses.map((status) => ({
                    label: formatEnumLabel(tCommon, status),
                    value: status,
                  })),
                ]}
                value={selectedStatus ?? ""}
              />
              <FilterPills
                ariaLabel={t("priorityFiltersAria")}
                name="priority"
                options={[
                  { label: t("anyPriority"), value: "" },
                  ...taskPriorities.map((priority) => ({
                    label: formatEnumLabel(tCommon, priority),
                    value: priority,
                  })),
                ]}
                value={selectedPriority ?? ""}
              />
            </div>
          </div>

          <FilterDisclosure
            hasFilters={hasFilters}
            label={tCommon("filtersLabel")}
          >
            <div className="filter-form">
              <FilterField icon={<RouteIcon />} label={t("route")}>
                <select
                  defaultValue={selectedRoutePlanId ?? ""}
                  name="routePlanId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {routeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<MapPinIcon />} label={t("location")}>
                <select
                  defaultValue={selectedLocationId ?? ""}
                  name="locationId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField icon={<UserIcon />} label={t("assignee")}>
                <select
                  defaultValue={selectedAssigneeId ?? ""}
                  name="assignedToUserId"
                >
                  <option value="">{tCommon("anyOption")}</option>
                  {assigneeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterDateRange
                fromLabel={t("dueFrom")}
                fromName="dueFrom"
                fromValue={dueFrom ?? ""}
                label={t("duePeriod")}
                placeholder={tCommon("datePlaceholder")}
                toLabel={t("dueTo")}
                toName="dueTo"
                toValue={dueTo ?? ""}
              />
              <FilterFooter
                resetHref={
                  hasFilters ? `/${tenantSlug}/manager/tasks` : undefined
                }
                resetLabel={tCommon("reset")}
                resultText={t.rich("filterResultCount", {
                  ...filterCountTags,
                  count: tasksResult.data.total,
                })}
              />
            </div>
          </FilterDisclosure>
        </FilterForm>

        {tasks.length > 0 ? (
          <TasksCards
            tasks={tasks}
            todayIsoDate={todayIsoDate}
            updateTaskStatusAction={updateTaskStatusAction}
            updateTaskDetailsAction={updateTaskDetailsAction}
            deleteTaskAction={canDeleteTasks ? deleteTaskAction : undefined}
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
              <a
                className="primary-button"
                href={`/${tenantSlug}/manager/tasks?assign=1`}
              >
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

function TasksCards({
  tasks,
  todayIsoDate,
  updateTaskStatusAction,
  updateTaskDetailsAction,
  deleteTaskAction,
}: {
  tasks: Task[];
  todayIsoDate: string;
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
  updateTaskDetailsAction: (formData: FormData) => Promise<void>;
  // Absent when the viewer lacks team scope: no delete affordance at all.
  deleteTaskAction?: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // One card layout at every width. The status pill doubles as the inline
  // editor (click to change it, saves on pick); the description lives behind
  // the "details" disclosure.
  return (
    <ul className="list-cards">
      {tasks.map((task) => {
        const overdue = isTaskOverdue(task, todayIsoDate);

        return (
          <li
            className={`list-card${overdue ? " is-overdue" : ""}`}
            key={task.id}
          >
            <div className="list-card-top">
              <h3 className="list-card-title">{task.title}</h3>
              <TaskStatusEditor
                taskId={task.id}
                status={task.status}
                ariaLabel={t("updateTaskStatusAria", { title: task.title })}
                updateAction={updateTaskStatusAction}
              />
            </div>
            <dl className="list-card-facts">
              <CardFact icon={<UserIcon />} label={t("tableAssignee")}>
                {task.assignedTo?.name ?? t("unassigned")}
              </CardFact>
              <CardFact icon={<MapPinIcon />} label={t("tableLocation")}>
                {task.location
                  ? `${task.location.name}, ${task.location.city}`
                  : t("noLocation")}
              </CardFact>
              <CardFact icon={<FlagIcon />} label={t("tablePriority")}>
                <PriorityTag
                  priority={task.priority}
                  label={formatEnumLabel(tCommon, task.priority)}
                />
              </CardFact>
              <CardFact icon={<CalendarIcon />} label={t("tableDue")}>
                <DueDate
                  format={format}
                  value={task.dueDate}
                  overdue={overdue}
                  overdueLabel={t("overdue")}
                />
              </CardFact>
            </dl>
            <TaskDetailsEditor
              taskId={task.id}
              value={task.description ?? ""}
              updateAction={updateTaskDetailsAction}
              actions={
                deleteTaskAction ? (
                  <DeleteTaskButton
                    taskId={task.id}
                    taskTitle={task.title}
                    deleteAction={deleteTaskAction}
                  />
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

function PriorityTag({
  priority,
  label,
}: {
  priority: TaskPriority;
  label: string;
}) {
  // The card fact already shows a flag in its <dt>; here we only tint the
  // label amber for "high" so it pops without a second icon.
  return (
    <span className={`priority-tag${priority === "high" ? " is-high" : ""}`}>
      {label}
    </span>
  );
}

function DueDate({
  format,
  value,
  overdue,
  overdueLabel,
}: {
  format: IntlFormatter;
  value: string | null;
  overdue: boolean;
  overdueLabel: string;
}) {
  if (!overdue) {
    return <>{formatDate(format, value)}</>;
  }

  return (
    <span className="due-overdue">
      {formatDate(format, value)}
      <span className="overdue-tag">{overdueLabel}</span>
    </span>
  );
}

type TasksTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.tasks">>
>;

function buildTaskCounters(
  tasks: Task[],
  total: number,
  t: TasksTranslator,
  todayIsoDate: string,
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
  const overdue = open.filter((task) => isTaskOverdue(task, todayIsoDate));

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

function formatDate(format: IntlFormatter, value: string | null): string {
  if (!value) {
    return "-";
  }

  return format.dateTime(new Date(value), { dateStyle: "medium" });
}

// A task is overdue only while it is still actionable: a past due date on a
// done or cancelled task is not flagged. Matches the "overdue" counter.
// Due dates are date-only "YYYY-MM-DD" strings, so a lexicographic compare
// against today's date in the tenant timezone is exact.
function isTaskOverdue(task: Task, todayIsoDate: string): boolean {
  if (!task.dueDate) {
    return false;
  }

  if (task.status !== "open" && task.status !== "in_progress") {
    return false;
  }

  return task.dueDate.slice(0, 10) < todayIsoDate;
}
