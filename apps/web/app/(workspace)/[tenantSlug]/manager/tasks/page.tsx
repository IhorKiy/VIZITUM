import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  getFormatter,
  getLocale,
  getTimeZone,
  getTranslations,
} from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import {
  AssignTaskModal,
  type AssignTaskActionResult,
} from "../../../../../components/assign-task-modal";
import { CardFact } from "../../../../../components/card-fact";
import { DeleteTaskButton } from "../../../../../components/delete-task-button";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import {
  EditAssignedTaskModal,
  type EditAssignedTaskActionResult,
} from "../../../../../components/edit-assigned-task-modal";
import { FilterDateRange } from "../../../../../components/filter-date-range";
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
  FlagIcon,
  MapPinIcon,
  RouteIcon,
  UserIcon,
} from "../../../../../components/icons";
import { PeriodPills } from "../../../../../components/period-pills";
import { TaskDetailsEditor } from "../../../../../components/task-details-editor";
import { TaskStatusEditor } from "../../../../../components/task-status-editor";
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
  type TaskStatus,
  type TaskStatusHistoryEntry,
} from "../../../../../lib/api-client";
import {
  buildLocationOptions,
  buildRouteOptions,
  type FilterOption,
} from "../../../../../lib/filter-options";
import { formatEnumLabel, type IntlFormatter } from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";
import {
  normalizePage,
  periodAsRead,
  periodLabel as formatPeriodLabel,
  periodSearchParams,
  PERIOD_MAX_MONTHS,
  resolvePeriodFromParams,
  TASK_COMPLETED_PERIOD_PARAMS,
} from "../../../../../lib/period";
import {
  buildTaskAssigneeOptions,
  buildTaskLocationOptions,
  parseTaskIsPriorityInput,
} from "../../../../../lib/task-form";
import { isTaskUnfinished, taskStatuses } from "../../../../../lib/task-status";

type ManagerTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    assign?: string;
    assignedToUserId?: string;
    deleted?: string;
    completedFrom?: string;
    completedTo?: string;
    dueFrom?: string;
    dueTo?: string;
    edited?: string;
    error?: string;
    locationId?: string;
    page?: string;
    // Set by the "Period…" pill: the range itself is already in the URL, this
    // only asks the filter panel to open on it.
    period?: string;
    priority?: string;
    routePlanId?: string;
    status?: string;
    task?: string;
    updated?: string;
  }>;
};

// The status pill that means "no status filter". A real value, because the
// filter form drops empty ones — see selectedStatus below.
const ALL_STATUSES = "all";

// The list used to ask for 100 rows and show them all, under a count that named
// the filtered total — so past 100 the screen quietly disagreed with itself.
// The completion window makes that far less likely, but "less likely" is not a
// fix. Paginated at 50, the same page size the manager visit list and the field
// lists use.
const PAGE_SIZE = 50;

export default async function ManagerTasksPage({
  params,
  searchParams,
}: ManagerTasksPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const [locale, timeZone, format, t, tManager, tAssign, tCommon, tPeriod] =
    await Promise.all([
      getLocale(),
      getTimeZone(),
      getFormatter(),
      getTranslations("manager.tasks"),
      getTranslations("manager"),
      getTranslations("manager.assignTask"),
      getTranslations("common"),
      getTranslations("common.period"),
    ]);
  // Due dates are date-only "YYYY-MM-DD" strings; "overdue" must be judged
  // against today's date in the tenant timezone (the same zone the formatted
  // dates render in), not the server's local midnight.
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );
  // Open work is what a manager opens this screen for, and it is the only half
  // of the list that stays a fixed size — finished tasks only accumulate. So
  // the list rests on open work; "all" and "done" are deliberate choices, and
  // both are read through a completion window rather than through everything
  // the team ever closed.
  // "all" has to be a real value rather than an empty one: FilterForm drops
  // empty fields, so an absent `status` cannot mean both "nothing chosen yet"
  // (which now rests on open work) and "the manager asked for everything".
  const selectedStatus =
    pageState.status === ALL_STATUSES
      ? null
      : (normalizeTaskStatus(pageState.status) ?? "in_progress");
  const windowsCompleted = selectedStatus !== "in_progress";
  // The window only bounds the finished half: on the mixed "all" view open
  // tasks ride through it untouched (see buildCompletedFilter in the API).
  const completedPeriod = windowsCompleted
    ? resolvePeriodFromParams(pageState, TASK_COMPLETED_PERIOD_PARAMS, timeZone)
    : null;
  const selectedPriorityOnly = pageState.priority === "1";
  const selectedAssigneeId = normalizeFilterValue(pageState.assignedToUserId);
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const selectedRoutePlanId = normalizeFilterValue(pageState.routePlanId);
  const dueFrom = normalizeDateFilter(pageState.dueFrom);
  const dueTo = normalizeDateFilter(pageState.dueTo);
  const page = normalizePage(pageState.page);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const hasFilters = Boolean(
    selectedStatus !== "in_progress" ||
    (completedPeriod && !completedPeriod.isDefault) ||
    selectedPriorityOnly ||
    selectedAssigneeId ||
    selectedLocationId ||
    selectedRoutePlanId ||
    dueFrom ||
    dueTo,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (completedPeriod) {
    for (const [name, value] of Object.entries(
      periodSearchParams(completedPeriod, TASK_COMPLETED_PERIOD_PARAMS),
    )) {
      query.set(name, value);
    }
  }

  if (selectedPriorityOnly) {
    query.set("isPriority", "true");
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

  // Everything the URL is currently narrowed by *except* the window itself.
  // The period pills are links, not form controls, so whatever they don't carry
  // is dropped: without this, changing the period would silently clear the
  // assignee, the location, the route and the deadline range the manager had
  // just set.
  const otherFilterParams = new URLSearchParams([
    ["status", selectedStatus ?? ALL_STATUSES],
    ...(selectedPriorityOnly ? [["priority", "1"]] : []),
    ...(selectedAssigneeId ? [["assignedToUserId", selectedAssigneeId]] : []),
    ...(selectedLocationId ? [["locationId", selectedLocationId]] : []),
    ...(selectedRoutePlanId ? [["routePlanId", selectedRoutePlanId]] : []),
    ...(dueFrom ? [["dueFrom", dueFrom]] : []),
    ...(dueTo ? [["dueTo", dueTo]] : []),
  ]);

  async function createTaskAction(
    formData: FormData,
  ): Promise<AssignTaskActionResult> {
    "use server";

    const title = getFormString(formData, "title").trim();
    const description = getFormString(formData, "description").trim();
    const isPriority = parseTaskIsPriorityInput(formData.get("isPriority"));
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
      isPriority,
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

  async function updateTaskFieldsAction(
    formData: FormData,
  ): Promise<EditAssignedTaskActionResult> {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(`/${tenantSlug}/manager/tasks?error=update`);
    }

    const title = getFormString(formData, "title").trim();

    // Failures return instead of redirecting: a redirect would remount the
    // page tree and throw away everything typed into the edit-task modal.
    if (!title) {
      return { ok: false };
    }

    const description = getFormString(formData, "description").trim();
    const isPriority = parseTaskIsPriorityInput(formData.get("isPriority"));
    const assignedToUserId = getFormString(formData, "assignedToUserId").trim();
    const locationId = getFormString(formData, "locationId").trim();
    const dueDate = getFormString(formData, "dueDate").trim();

    const result = await updateTask(taskId, {
      title,
      description: description || null,
      isPriority,
      assignedToUserId: assignedToUserId || null,
      locationId: locationId || null,
      dueDate: dueDate || null,
    });

    if (!result.ok) {
      return { ok: false };
    }

    redirect(`/${tenantSlug}/manager/tasks?edited=1`);
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
    // today and no task yet would otherwise be unassignable here. Asks for the
    // API's maximum page, the way every other manager list does — the default
    // page would silently drop assignable people past the 50th visit.
    listVisits("pageSize=100"),
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
  // What the API actually read, which is what the recap below names. A saved
  // link asking past the maximum window length comes back trimmed, and a recap
  // still announcing the requested range would put a lie in the denominator of
  // the count beside it. Absent mid-deploy, when this build talks to the
  // previous API — then the window stands as resolved.
  const period = completedPeriod
    ? periodAsRead(
        completedPeriod,
        tasksResult.data.completedPeriod?.completedFrom,
        timeZone,
      )
    : null;
  const totalPages = tasksResult.data.totalPages;
  // Built from the screen's own parameters, not from `query`. The two agree on
  // most names but not all, and both disagreements are silent: `query` omits
  // `status` for the mixed view (so a page link would come back as the default
  // in-progress list, quietly changing the view mid-scroll) and spells the
  // priority filter `isPriority=true` where the screen reads `priority=1` (so
  // page 2 would drop the filter and carry a dead parameter instead).
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams(otherFilterParams);

    if (period) {
      for (const [name, value] of Object.entries(
        periodSearchParams(period, TASK_COMPLETED_PERIOD_PARAMS),
      )) {
        params.set(name, value);
      }
    }

    if (targetPage > 1) {
      params.set("page", String(targetPage));
    }

    return `/${tenantSlug}/manager/tasks?${params.toString()}`;
  };
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
              {tAssign("assignAnother")}
            </a>
          }
          ariaLabel={tAssign("taskStatusAria")}
          body={tAssign("taskCreatedBody")}
          clearParams={["task"]}
          eyebrow={tAssign("taskCreatedEyebrow")}
          title={tAssign("taskCreatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.updated ? (
        <DismissableNotice
          ariaLabel={t("updateAria")}
          clearParams={["updated"]}
          eyebrow={t("updatedEyebrow")}
          title={t("updatedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.edited ? (
        <DismissableNotice
          ariaLabel={t("updateAria")}
          clearParams={["edited"]}
          eyebrow={t("taskEditedEyebrow")}
          title={t("taskEditedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.deleted ? (
        <DismissableNotice
          ariaLabel={t("deletedAria")}
          clearParams={["deleted"]}
          eyebrow={t("deletedEyebrow")}
          title={t("deletedTitle")}
          tone="success"
        />
      ) : null}

      {pageState.error ? (
        <DismissableNotice
          ariaLabel={t("errorAria")}
          body={t("errorBody")}
          clearParams={["error"]}
          eyebrow={
            pageState.error === "delete"
              ? t("deleteErrorEyebrow")
              : t("errorEyebrow")
          }
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
              {/* How deep the list reads sits above what it cuts by. Only the
                  views that can hold finished work have a window at all. */}
              {period ? (
                <PeriodPills
                  action={`/${tenantSlug}/manager/tasks`}
                  ariaLabel={t("completedPeriod")}
                  names={TASK_COMPLETED_PERIOD_PARAMS}
                  otherParams={otherFilterParams}
                  period={period}
                  timeZone={timeZone}
                />
              ) : null}
              <FilterPills
                ariaLabel={t("statusFiltersAria")}
                name="status"
                options={[
                  { label: tCommon("all"), value: ALL_STATUSES },
                  ...taskStatuses.map((status) => ({
                    label: formatEnumLabel(tCommon, status),
                    value: status,
                  })),
                ]}
                value={selectedStatus ?? ALL_STATUSES}
              />
              <FilterPills
                ariaLabel={t("priorityFiltersAria")}
                name="priority"
                options={[
                  { label: tCommon("all"), value: "" },
                  { label: t("priorityOnly"), value: "1" },
                ]}
                value={selectedPriorityOnly ? "1" : ""}
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
              {/* Where the "Period…" pill lands. Seeded with the resolved
                  window rather than with whatever the URL carried: editing one
                  end of the default period should narrow those 30 days, not
                  open an unbounded range. */}
              {period ? (
                <FilterDateRange
                  fromLabel={t("completedFrom")}
                  fromName={TASK_COMPLETED_PERIOD_PARAMS.from}
                  fromValue={period.from}
                  label={t("completedPeriod")}
                  placeholder={tCommon("datePlaceholder")}
                  toLabel={t("completedTo")}
                  toName={TASK_COMPLETED_PERIOD_PARAMS.to}
                  toValue={period.to}
                />
              ) : null}
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

        {/* The period leads the line: a count of finished work with no window
            behind it is a number without a denominator. What follows it depends
            on what the window actually cut — a done-only list is the window, so
            it takes the count; the mixed list needs saying that only its
            finished half is bounded, or the number above reads as a total. */}
        {period ? (
          <p className="list-count-summary">
            <strong>{formatPeriodLabel(tPeriod, format, period)}</strong>
            <span>
              {selectedStatus === "done"
                ? t("doneCount", { count: tasksResult.data.total })
                : t("completedInPeriod")}
            </span>
            {/* A trimmed window is not the end of the history — the months
                behind it are one date range away — so this points at the
                filter rather than implying there is nothing older. */}
            {period.clamped ? (
              <span>
                {t("periodWindowCapped", { months: PERIOD_MAX_MONTHS })}
              </span>
            ) : null}
          </p>
        ) : null}

        {tasks.length > 0 ? (
          <>
            <TasksCards
              assigneeOptions={assignAssigneeOptions}
              deleteTaskAction={canDeleteTasks ? deleteTaskAction : undefined}
              locationOptions={locationOptions}
              tasks={tasks}
              todayIsoDate={todayIsoDate}
              updateTaskDetailsAction={updateTaskDetailsAction}
              updateTaskFieldsAction={updateTaskFieldsAction}
              updateTaskStatusAction={updateTaskStatusAction}
            />
            {totalPages > 1 ? (
              <nav aria-label={t("paginationAria")} className="list-pagination">
                {page > 1 ? (
                  <a className="secondary-button" href={pageHref(page - 1)}>
                    {t("pagePrevious")}
                  </a>
                ) : null}
                <p className="small-label">
                  {t("pagePosition", { page, totalPages })}
                </p>
                {page < totalPages ? (
                  <a className="secondary-button" href={pageHref(page + 1)}>
                    {t("pageNext")}
                  </a>
                ) : null}
              </nav>
            ) : null}
          </>
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
                {tAssign("title")}
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
  assigneeOptions,
  locationOptions,
  tasks,
  todayIsoDate,
  updateTaskStatusAction,
  updateTaskDetailsAction,
  updateTaskFieldsAction,
  deleteTaskAction,
}: {
  assigneeOptions: { id: string; label: string }[];
  locationOptions: { id: string; label: string }[];
  tasks: Task[];
  todayIsoDate: string;
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
  updateTaskDetailsAction: (formData: FormData) => Promise<void>;
  updateTaskFieldsAction: (
    formData: FormData,
  ) => Promise<EditAssignedTaskActionResult>;
  // Absent when the viewer lacks team scope: no delete affordance at all.
  deleteTaskAction?: (formData: FormData) => Promise<void>;
}) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  // One card layout at every width. The status pill doubles as the inline
  // editor (click to change it, saves on pick); the description and history
  // live behind their own disclosures.
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
              <h3 className="list-card-title">
                {task.title}
                {task.isPriority ? (
                  <span className="priority-tag">
                    <FlagIcon />
                    {t("priorityBadge")}
                  </span>
                ) : null}
              </h3>
              <div className="list-card-top-actions">
                <TaskStatusEditor
                  taskId={task.id}
                  status={task.status}
                  ariaLabel={t("updateTaskStatusAria", { title: task.title })}
                  updateAction={updateTaskStatusAction}
                />
                <EditAssignedTaskModal
                  action={updateTaskFieldsAction}
                  assigneeOptions={assigneeOptions}
                  locationOptions={locationOptions}
                  task={task}
                />
              </div>
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
            <TaskHistory
              createdByName={task.createdBy?.name ?? null}
              createdAt={task.createdAt}
              history={task.history}
              format={format}
              t={t}
              tCommon={tCommon}
            />
          </li>
        );
      })}
    </ul>
  );
}

type TasksTranslator = Awaited<
  ReturnType<typeof getTranslations<"manager.tasks">>
>;
type CommonTranslator = Awaited<ReturnType<typeof getTranslations<"common">>>;

// Read-only: who created the task (always known, even for tasks that predate
// this feature) plus every recorded status change. Tasks from before the
// history table existed simply have an empty `history` array, so they fall
// back to showing only the creation line — exactly the intended behavior.
function TaskHistory({
  createdByName,
  createdAt,
  history,
  format,
  t,
  tCommon,
}: {
  createdByName: string | null;
  createdAt: string;
  history: TaskStatusHistoryEntry[];
  format: IntlFormatter;
  t: TasksTranslator;
  tCommon: CommonTranslator;
}) {
  // The creation row (oldStatus === null) is already represented by the
  // "created by" line below, so only real transitions show as history rows.
  const statusChanges = history.filter((entry) => entry.oldStatus !== null);

  return (
    <details className="task-history">
      <summary>{t("history")}</summary>
      <ul className="task-history-list">
        <li>
          {t("historyCreated", {
            name: createdByName ?? tCommon("unknown"),
            date: formatDateTime(format, createdAt),
          })}
        </li>
        {statusChanges.map((entry) => (
          <li key={entry.id}>
            {t("historyStatusChanged", {
              status: formatEnumLabel(tCommon, entry.newStatus),
              name: entry.changedBy?.name ?? tCommon("unknown"),
              date: formatDateTime(format, entry.createdAt),
            })}
          </li>
        ))}
      </ul>
    </details>
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
  const unfinished = tasks.filter((task) => isTaskUnfinished(task.status));
  const priorityTasks = unfinished.filter((task) => task.isPriority);
  const overdue = unfinished.filter((task) =>
    isTaskOverdue(task, todayIsoDate),
  );

  return [
    {
      label: t("visibleTasks"),
      value: String(total),
      detail: t("loadedOnPage", { count: tasks.length }),
      tone: "active",
    },
    {
      label: t("openWork"),
      value: String(unfinished.length),
      detail: t("openWorkDetail", { count: priorityTasks.length }),
      tone: priorityTasks.length > 0 ? "warning" : "active",
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
  if (value === "in_progress" || value === "done") {
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

function formatDateTime(format: IntlFormatter, value: string): string {
  return format.dateTime(new Date(value), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// A task is overdue only while it is still actionable: a past due date on a
// done task is not flagged. Matches the "overdue" counter.
// Due dates are date-only "YYYY-MM-DD" strings, so a lexicographic compare
// against today's date in the tenant timezone is exact.
function isTaskOverdue(task: Task, todayIsoDate: string): boolean {
  if (!task.dueDate) {
    return false;
  }

  if (!isTaskUnfinished(task.status)) {
    return false;
  }

  return task.dueDate.slice(0, 10) < todayIsoDate;
}
