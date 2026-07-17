import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { CardFact } from "../../../../components/card-fact";
import { DismissableNotice } from "../../../../components/dismissable-notice";
import { FilterDateRange } from "../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../components/filter-disclosure";
import { FilterField } from "../../../../components/filter-field";
import {
  FilterFooter,
  filterCountTags,
} from "../../../../components/filter-footer";
import { FilterForm } from "../../../../components/filter-form";
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
import {
  formatEnumLabel,
  type CommonTranslator,
  type IntlFormatter,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { taskStatuses } from "../../../../lib/task-status";

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

const taskPriorities: TaskPriority[] = ["high", "normal", "low"];

export default async function ManagerTasksPage({
  params,
  searchParams,
}: ManagerTasksPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [locale, timeZone, t, tManager, tCommon] = await Promise.all([
    getLocale(),
    getTimeZone(),
    getTranslations("manager.tasks"),
    getTranslations("manager"),
    getTranslations("common"),
  ]);
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
      </header>

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

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={t("errorEyebrow")}
          title={t("errorTitle")}
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

        <FilterDisclosure
          hasFilters={hasFilters}
          label={tCommon("filtersLabel")}
        >
          <FilterForm
            action={`/${tenantSlug}/manager/tasks`}
            className="filter-form"
          >
            {selectedStatus ? (
              <input name="status" type="hidden" value={selectedStatus} />
            ) : null}
            {selectedPriority ? (
              <input name="priority" type="hidden" value={selectedPriority} />
            ) : null}
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
              <select defaultValue={selectedLocationId ?? ""} name="locationId">
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
          </FilterForm>
        </FilterDisclosure>

        {tasks.length > 0 ? (
          <TasksCards
            tasks={tasks}
            todayIsoDate={todayIsoDate}
            updateTaskStatusAction={updateTaskStatusAction}
            updateTaskDetailsAction={updateTaskDetailsAction}
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

function TasksCards({
  tasks,
  todayIsoDate,
  updateTaskStatusAction,
  updateTaskDetailsAction,
}: {
  tasks: Task[];
  todayIsoDate: string;
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
  updateTaskDetailsAction: (formData: FormData) => Promise<void>;
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
