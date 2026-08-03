import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  getFormatter,
  getLocale,
  getTimeZone,
  getTranslations,
} from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { BackLink } from "../../../../../components/back-link";
import { CardFact } from "../../../../../components/card-fact";
import {
  CreateOwnTaskModal,
  type CreateOwnTaskActionResult,
} from "../../../../../components/create-own-task-modal";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import {
  EditTaskModal,
  type EditTaskActionResult,
} from "../../../../../components/edit-task-modal";
import { FilterDateRange } from "../../../../../components/filter-date-range";
import { FilterDisclosure } from "../../../../../components/filter-disclosure";
import { FilterFooter } from "../../../../../components/filter-footer";
import { FilterForm } from "../../../../../components/filter-form";
import { FilterPills } from "../../../../../components/filter-pills";
import { FilterTogglePills } from "../../../../../components/filter-toggle-pills";
import {
  CalendarIcon,
  FlagIcon,
  MapPinIcon,
} from "../../../../../components/icons";
import { PeriodPills } from "../../../../../components/period-pills";
import { TaskDetailsEditor } from "../../../../../components/task-details-editor";
import { TaskStatusEditor } from "../../../../../components/task-status-editor";
import {
  createTask,
  getCurrentSession,
  listLocations,
  listTasks,
  updateTask,
  type Task,
  type TaskStatus,
  type TaskStatusHistoryEntry,
} from "../../../../../lib/api-client";
import { buildLocationOptions } from "../../../../../lib/filter-options";
import { formatEnumLabel, type IntlFormatter } from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";
import {
  hasEarlierPeriod,
  historyFloor,
  normalizePage,
  periodAsRead,
  periodLabel as formatPeriodLabel,
  periodSearchParams,
  PERIOD_MAX_MONTHS,
  previousPeriod,
  resolvePeriodFromParams,
  TASK_COMPLETED_PERIOD_PARAMS,
} from "../../../../../lib/period";
import { parseTaskIsPriorityInput } from "../../../../../lib/task-form";
import { isTaskUnfinished, taskStatuses } from "../../../../../lib/task-status";

type FieldTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    completedFrom?: string;
    completedTo?: string;
    create?: string;
    error?: string;
    overdue?: string;
    page?: string;
    // Set by the "Period…" pill: the range itself is already in the URL, this
    // only asks the filter panel to open on it.
    period?: string;
    priority?: string;
    status?: string;
    task?: string;
  }>;
};

// Half the API's max, the same page size the field visit history uses: this is
// a phone screen, and anything older is one step back through the period away.
const DONE_PAGE_SIZE = 50;

export default async function FieldTasksPage({
  params,
  searchParams,
}: FieldTasksPageProps) {
  const { tenantSlug } = await params;
  const [
    locale,
    timeZone,
    format,
    t,
    tBack,
    tField,
    tCreateTask,
    tCommon,
    tPeriod,
  ] = await Promise.all([
    getLocale(),
    getTimeZone(),
    getFormatter(),
    getTranslations("field.tasks"),
    getTranslations("common.back"),
    getTranslations("field"),
    getTranslations("field.createTask"),
    getTranslations("common"),
    getTranslations("common.period"),
  ]);
  // Due dates are date-only "YYYY-MM-DD" strings; "overdue" must be judged
  // against today's date in the tenant timezone, not the server's local
  // midnight (mirrors manager/tasks/page.tsx).
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();
    const status = normalizeTaskStatus(formData.get("status"));

    if (!taskId || !status) {
      redirect(`/${tenantSlug}/field/tasks?error=task`);
    }

    const result = await updateTask(taskId, { status });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/tasks?error=task`);
    }

    redirect(`/${tenantSlug}/field/tasks?task=updated`);
  }

  async function updateTaskDetailsAction(formData: FormData) {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(`/${tenantSlug}/field/tasks?error=task`);
    }

    const description = getFormString(formData, "description").trim();
    const result = await updateTask(taskId, {
      description: description || null,
    });

    if (!result.ok) {
      redirect(`/${tenantSlug}/field/tasks?error=task`);
    }

    redirect(`/${tenantSlug}/field/tasks?task=updated`);
  }

  async function updateTaskFieldsAction(
    formData: FormData,
  ): Promise<EditTaskActionResult> {
    "use server";

    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(`/${tenantSlug}/field/tasks?error=task`);
    }

    const title = getFormString(formData, "title").trim();

    // Failures return instead of redirecting: a redirect would remount the
    // page tree and throw away everything typed into the edit-task modal.
    if (!title) {
      return { ok: false };
    }

    const description = getFormString(formData, "description").trim();
    const isPriority = parseTaskIsPriorityInput(formData.get("isPriority"));
    const locationId = getFormString(formData, "locationId").trim();
    const dueDate = getFormString(formData, "dueDate").trim();

    const result = await updateTask(taskId, {
      title,
      description: description || null,
      isPriority,
      locationId: locationId || null,
      dueDate: dueDate || null,
    });

    if (!result.ok) {
      return { ok: false };
    }

    redirect(`/${tenantSlug}/field/tasks?task=edited`);
  }

  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("tasks.read_own")
  ) {
    return (
      <AppShell activeArea="field-tasks" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
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
          aria-label={t("permissionStatusAria")}
          className="notice-panel"
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

  // Narrowed to a plain string here (outside the nested action below) so the
  // "use server" closure below captures a value, not a re-widened union —
  // TypeScript does not carry the `sessionResult.ok` narrowing into a nested
  // function that runs later.
  const currentUserId = sessionResult.data.user.id;

  async function createTaskAction(
    formData: FormData,
  ): Promise<CreateOwnTaskActionResult> {
    "use server";

    const title = getFormString(formData, "title").trim();
    const description = getFormString(formData, "description").trim();
    const isPriority = parseTaskIsPriorityInput(formData.get("isPriority"));
    const locationId = getFormString(formData, "locationId").trim();
    const dueDate = getFormString(formData, "dueDate").trim();

    // Failures return instead of redirecting: a redirect would remount the
    // page tree and throw away everything typed into the create-task modal.
    if (!title) {
      return { ok: false };
    }

    const result = await createTask({
      title,
      isPriority,
      assignedToUserId: currentUserId,
      ...(description ? { description } : {}),
      ...(locationId ? { locationId } : {}),
      ...(dueDate ? { dueDate } : {}),
    });

    if (!result.ok) {
      return { ok: false };
    }

    redirect(`/${tenantSlug}/field/tasks?task=created`);
  }

  const pageState = await searchParams;
  const { task, error } = pageState;
  // No "all" option: the status toggle always resolves to one of the two
  // statuses, defaulting to in_progress on first load (an absent/invalid
  // query value).
  const selectedStatus = normalizeTaskStatus(pageState.status) ?? "in_progress";
  // Priority only ever filters the in-progress view — done tasks are never
  // priority-filtered, so a stale ?priority=1 left over from switching away
  // from in_progress must not silently apply here.
  const selectedPriorityOnly =
    selectedStatus === "in_progress" && pageState.priority === "1";
  // Same reasoning for overdue, with a second one on top: a done task is never
  // overdue (isTaskOverdue below), so the filter would empty the done list
  // outright rather than narrow it.
  const selectedOverdueOnly =
    selectedStatus === "in_progress" && pageState.overdue === "1";
  // Open work and finished work are two different lists, and only one of them
  // grows without bound. Open tasks are self-limiting — there are as many as
  // there is work outstanding — so that list stays whole on one page, which is
  // also what the #task-<id> anchor a location card links here with relies on.
  // Finished tasks only ever accumulate, so that list is read through a window
  // and paged inside it.
  const isDoneList = selectedStatus === "done";
  // The window the done list reads through: the last 30 days in the tenant's
  // timezone unless the URL names another. Resolved here rather than left to
  // the API so the recap can say which period its count describes.
  const completedPeriod = isDoneList
    ? resolvePeriodFromParams(pageState, TASK_COMPLETED_PERIOD_PARAMS, timeZone)
    : null;
  const page = normalizePage(pageState.page);
  const query = new URLSearchParams(
    isDoneList
      ? { page: String(page), pageSize: String(DONE_PAGE_SIZE) }
      : { pageSize: "100" },
  );
  const hasFilters =
    selectedStatus !== "in_progress" ||
    selectedPriorityOnly ||
    selectedOverdueOnly;

  query.set("status", selectedStatus);

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

  // The API has no "overdue" flag, only a due-date range, and its dueTo bound
  // is inclusive — so "due before today" is expressed as "due up to and
  // including yesterday", in the tenant timezone the day was resolved in.
  // Tasks with no due date drop out, which is what overdue means for them.
  if (selectedOverdueOnly) {
    query.set("dueTo", previousIsoDate(todayIsoDate));
  }

  const [tasksResult, locationsResult] = await Promise.all([
    listTasks(query.toString()),
    listLocations(),
  ]);

  if (!tasksResult.ok) {
    return (
      <AppShell activeArea="field-tasks" tenantSlug={tenantSlug}>
        <BackLink href={`/${tenantSlug}/field`} label={tBack("home")} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
        </header>

        <section
          aria-label={tCommon("notice.apiStatus")}
          className="notice-panel"
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
  // What the API actually read: a window longer than the maximum comes back
  // trimmed, and a recap naming the requested range would count days nobody
  // looked at. Absent mid-deploy, when this build talks to the previous API —
  // in which case the window stands as resolved.
  const period =
    completedPeriod &&
    periodAsRead(
      completedPeriod,
      tasksResult.data.completedPeriod?.completedFrom,
      timeZone,
    );
  // The bottom of the done list is the rep's own first finished task, which
  // only the API can name. `null` is the API saying this rep has finished
  // nothing at all; absent (an older API, or an unwindowed list) claims
  // nothing, and the step back stays offered rather than announcing an end.
  const completedFloor = historyFloor(
    period ? tasksResult.data.completedHistoryStart : undefined,
    timeZone,
  );
  const totalPages = tasksResult.data.totalPages;
  const earlier = period ? previousPeriod(period) : null;
  // Whether there is anything behind this window at all. With no answer the
  // step stays offered rather than announcing an end nobody confirmed.
  const canReachEarlier = period
    ? hasEarlierPeriod(period, completedFloor)
    : false;
  // This rep has finished nothing, ever — which is not the same as this window
  // being empty, and takes different words. A narrow window empties the list
  // all the time with finished tasks sitting right behind it, so it is the
  // floor that separates them and never `tasks.length`.
  const noneEverCompleted = completedFloor.state === "empty";
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams(query);
    params.delete("pageSize");

    if (targetPage <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(targetPage));
    }

    return `/${tenantSlug}/field/tasks?${params.toString()}`;
  };
  const earlierHref = earlier
    ? `/${tenantSlug}/field/tasks?${new URLSearchParams({
        status: "done",
        ...periodSearchParams(earlier, TASK_COMPLETED_PERIOD_PARAMS),
        // Opens the filter panel on the range it just moved to, so the next
        // step back is one edit away rather than a second guess.
        period: "custom",
      }).toString()}`
    : null;
  // Two different endings, which must not be collapsed into one claim. Reaching
  // the first finished task really is the end. Hitting the maximum window
  // length is not — the months behind a trimmed window are one date range away
  // — so that case points at the filter and keeps the step back. The trimmed
  // note stands down once the first finished task is inside the window: there
  // is nothing further to dig for, and saying otherwise is the walk into
  // nothing this block exists to prevent.
  const earlierPeriodLink =
    period && earlier && earlierHref ? (
      canReachEarlier ? (
        <>
          <a className="secondary-button" href={earlierHref}>
            {t("periodEarlier", {
              period: formatPeriodLabel(tPeriod, format, {
                ...earlier,
                preset: "custom",
              }),
            })}
          </a>
          {period.clamped ? (
            <p className="small-label">
              {t("periodWindowCapped", { months: PERIOD_MAX_MONTHS })}
            </p>
          ) : null}
        </>
      ) : noneEverCompleted ? null : (
        <p className="small-label">{t("periodOldestReached")}</p>
      )
    ) : null;
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const locationOptions = buildLocationOptions(locations, locale);
  // "Assigned locations" for the create form: the locations this rep has an
  // active LocationAssignment for (already returned on every Location by
  // GET /locations), not every active location in the tenant.
  const assignedLocationOptions = buildLocationOptions(
    locations.filter((location) =>
      location.assignments.some(
        (assignment) => assignment.representativeUserId === currentUserId,
      ),
    ),
    locale,
  );

  return (
    <AppShell activeArea="field-tasks" tenantSlug={tenantSlug}>
      <header className="page-header page-header--inline">
        <div>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <CreateOwnTaskModal
            action={createTaskAction}
            locationOptions={assignedLocationOptions}
          />
        </div>
      </header>

      {task === "created" ? (
        <DismissableNotice
          ariaLabel={t("taskStatusAria")}
          clearParams={["task"]}
          eyebrow={t("taskCreatedEyebrow")}
          title={t("taskCreatedTitle")}
          tone="success"
        />
      ) : null}

      {task === "updated" ? (
        <DismissableNotice
          ariaLabel={t("taskStatusAria")}
          clearParams={["task"]}
          eyebrow={t("taskUpdatedEyebrow")}
          title={t("taskUpdatedTitle")}
          tone="success"
        />
      ) : null}

      {task === "edited" ? (
        <DismissableNotice
          ariaLabel={t("taskStatusAria")}
          clearParams={["task"]}
          eyebrow={t("taskEditedEyebrow")}
          title={t("taskEditedTitle")}
          tone="success"
        />
      ) : null}

      {error === "task" ? (
        <DismissableNotice
          ariaLabel={t("taskErrorAria")}
          body={t("taskErrorBody")}
          clearParams={["error"]}
          eyebrow={t("taskErrorEyebrow")}
          title={t("taskErrorTitle")}
          tone="danger"
        />
      ) : null}

      <section aria-label={t("listAria")} className="panel drilldown-panel">
        <FilterForm action={`/${tenantSlug}/field/tasks`}>
          <div className="panel-toolbar">
            <div className="filter-groups">
              {/* Finished work only accumulates, so the done list leads with
                  how deep it reads. Open work needs no window — there are as
                  many open tasks as there is work outstanding. */}
              {period ? (
                <PeriodPills
                  action={`/${tenantSlug}/field/tasks`}
                  ariaLabel={t("completedPeriod")}
                  names={TASK_COMPLETED_PERIOD_PARAMS}
                  // Status is the whole of it here, and deliberately so: the
                  // priority and overdue toggles are only ever live on the
                  // in-progress list (see selectedPriorityOnly above), so there
                  // is no other filter for a period link to drop.
                  otherParams={new URLSearchParams({ status: "done" })}
                  period={period}
                  timeZone={timeZone}
                />
              ) : null}
              <FilterPills
                ariaLabel={t("statusFiltersAria")}
                name="status"
                options={taskStatuses.map((status) => ({
                  label: formatEnumLabel(tCommon, status),
                  value: status,
                }))}
                value={selectedStatus}
              />
              {selectedStatus === "in_progress" ? (
                <FilterTogglePills
                  ariaLabel={t("refineFiltersAria")}
                  options={[
                    {
                      checked: selectedPriorityOnly,
                      label: t("priorityFilter"),
                      name: "priority",
                      tone: "priority",
                    },
                    {
                      checked: selectedOverdueOnly,
                      label: t("overdueFilter"),
                      name: "overdue",
                      tone: "overdue",
                    },
                  ]}
                />
              ) : null}
            </div>
            <p className="filter-result-count">
              {t("taskCount", { count: tasksResult.data.total })}
            </p>
          </div>

          {/* Only the done list has a window to edit by hand, and this is where
              its "Period…" pill lands. Seeded with the resolved window rather
              than with whatever the URL carried: editing one end of the default
              period should narrow those 30 days, not open an unbounded range. */}
          {period ? (
            <FilterDisclosure
              hasFilters={!period.isDefault || pageState.period === "custom"}
              label={tCommon("filtersLabel")}
            >
              <div className="filter-form field-history-filter-form">
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
                <FilterFooter
                  resetHref={
                    period.isDefault
                      ? undefined
                      : `/${tenantSlug}/field/tasks?status=done`
                  }
                  resetLabel={tCommon("reset")}
                />
              </div>
            </FilterDisclosure>
          ) : null}
        </FilterForm>

        {/* The period leads the line: a count with no window behind it is a
            number without a denominator. */}
        {period ? (
          <p className="list-count-summary">
            <strong>{formatPeriodLabel(tPeriod, format, period)}</strong>
            <span>{t("doneCount", { count: tasksResult.data.total })}</span>
          </p>
        ) : null}

        {tasks.length > 0 ? (
          <>
            <TasksCards
              locationOptions={locationOptions}
              tasks={tasks}
              todayIsoDate={todayIsoDate}
              updateTaskDetailsAction={updateTaskDetailsAction}
              updateTaskFieldsAction={updateTaskFieldsAction}
              updateTaskStatusAction={updateTaskStatusAction}
            />
            {period && totalPages > 1 ? (
              <nav aria-label={t("paginationAria")} className="list-pagination">
                {page > 1 ? (
                  <a className="secondary-button" href={pageHref(page - 1)}>
                    {t("showNewer")}
                  </a>
                ) : null}
                <p className="small-label">
                  {t("pagePosition", { page, totalPages })}
                </p>
                {page < totalPages ? (
                  <a className="secondary-button" href={pageHref(page + 1)}>
                    {t("showEarlier")}
                  </a>
                ) : null}
              </nav>
            ) : null}
            {/* Paging stops at the edge of the window rather than sliding
                silently into the archive: the last page hands over to the
                period control, which is the thing that reaches further back. */}
            {period && page >= totalPages ? (
              <div className="period-exhausted">
                <p className="small-label">{t("periodExhaustedTitle")}</p>
                <p>{t("periodExhaustedBody")}</p>
                {earlierPeriodLink}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state-panel">
            {/* An empty window and an empty history are different answers and
                get different words. "Nothing matches this filter" is true of a
                narrow window; it is wrong for a rep who has never finished
                anything, where no filter and no date will ever help. */}
            <h2>
              {noneEverCompleted ? t("emptyDoneEverTitle") : t("emptyTitle")}
            </h2>
            <p>{noneEverCompleted ? t("emptyDoneEverBody") : t("emptyBody")}</p>
            <div className="toolbar">
              {/* An empty window is the one case where reaching further back is
                  the obvious next move. With nothing ever finished there is no
                  step to offer, and the panel above already said so once. */}
              {noneEverCompleted ? null : earlierPeriodLink}
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/field/tasks`}
                >
                  {t("resetFilter")}
                </a>
              ) : null}
              <a
                className="primary-button"
                href={`/${tenantSlug}/field/tasks?create=1`}
              >
                {tCreateTask("title")}
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

// One card layout at every width, matching manager/tasks/page.tsx's
// TasksCards: the status pill doubles as the inline editor (click to change
// it, saves on pick), and the description and history live behind their own
// disclosures. Own-scope tasks have no assignee to show and no team-delete
// affordance.
function TasksCards({
  locationOptions,
  tasks,
  todayIsoDate,
  updateTaskStatusAction,
  updateTaskDetailsAction,
  updateTaskFieldsAction,
}: {
  locationOptions: { id: string; label: string }[];
  tasks: Task[];
  todayIsoDate: string;
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
  updateTaskDetailsAction: (formData: FormData) => Promise<void>;
  updateTaskFieldsAction: (formData: FormData) => Promise<EditTaskActionResult>;
}) {
  const t = useTranslations("field.tasks");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  return (
    <ul className="list-cards">
      {tasks.map((task) => {
        const overdue = isTaskOverdue(task, todayIsoDate);

        return (
          <li
            className={`list-card${overdue ? " is-overdue" : ""}`}
            id={`task-${task.id}`}
            key={task.id}
          >
            <div className="list-card-top">
              <h3 className="list-card-title">
                {task.title}
                {task.isPriority ? (
                  <span className="priority-tag">
                    <FlagIcon />
                    {t("priority")}
                  </span>
                ) : null}
              </h3>
              <div className="list-card-top-actions">
                <TaskStatusEditor
                  ariaLabel={t("updateTaskStatusAria", { title: task.title })}
                  status={task.status}
                  taskId={task.id}
                  updateAction={updateTaskStatusAction}
                />
                <EditTaskModal
                  action={updateTaskFieldsAction}
                  locationOptions={locationOptions}
                  task={task}
                />
              </div>
            </div>
            <dl className="list-card-facts">
              <CardFact icon={<MapPinIcon />} label={t("location")}>
                {task.location
                  ? `${task.location.name}, ${task.location.city}`
                  : t("noLocation")}
              </CardFact>
              <CardFact icon={<CalendarIcon />} label={t("due")}>
                <DueDate
                  format={format}
                  overdue={overdue}
                  overdueLabel={t("overdue")}
                  value={task.dueDate}
                />
              </CardFact>
            </dl>
            <TaskDetailsEditor
              taskId={task.id}
              updateAction={updateTaskDetailsAction}
              value={task.description ?? ""}
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

type FieldTasksTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.tasks">>
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
  t: FieldTasksTranslator;
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
// done task is just history, not something outstanding.
function isTaskOverdue(task: Task, todayIsoDate: string): boolean {
  if (!task.dueDate) {
    return false;
  }

  if (!isTaskUnfinished(task.status)) {
    return false;
  }

  return task.dueDate.slice(0, 10) < todayIsoDate;
}

// The day before a "YYYY-MM-DD" date, computed in UTC so the arithmetic never
// crosses a DST boundary in the server's local zone: the input already carries
// the tenant's day, and only the calendar step is being taken here.
function previousIsoDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
}

function normalizeTaskStatus(
  value: FormDataEntryValue | string | null | undefined,
): TaskStatus | null {
  if (value === "in_progress" || value === "done") {
    return value;
  }

  return null;
}
