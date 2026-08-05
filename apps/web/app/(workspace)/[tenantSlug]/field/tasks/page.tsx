import type { ReactNode } from "react";
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
import {
  ChevronRightIcon,
  FlagIcon,
  MapPinIcon,
} from "../../../../../components/icons";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import { PeriodPills } from "../../../../../components/period-pills";
import { ScrollStrip } from "../../../../../components/scroll-strip";
import { TaskSheet } from "../../../../../components/task-sheet";
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
import {
  describeTaskDue,
  formatDueDate,
  groupTasksByDue,
  type TaskDueGroupKey,
  type TaskDueState,
} from "../../../../../lib/task-due";
import { parseTaskIsPriorityInput } from "../../../../../lib/task-form";

type FieldTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    completedFrom?: string;
    completedTo?: string;
    create?: string;
    error?: string;
    overdue?: string;
    page?: string;
    // The task whose sheet is open, by id.
    open?: string;
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
// The open list is read whole, never paged — see isDoneList below. The cap is
// the API's own maximum; a rep holding more open tasks than this has a problem
// no list layout solves.
const OPEN_PAGE_SIZE = 100;
// The "closed today" tail is a day's work, not an archive: one day cannot
// plausibly hold more than this, and the done list is where the rest lives.
const CLOSED_TODAY_PAGE_SIZE = 50;

// Query params that say something about this visit rather than about which
// list is being read: a notice to show once, a dialog that is open. They are
// dropped when the page rebuilds its own address.
const NON_LIST_PARAMS = ["create", "error", "open", "task"];

// The heading each band of the open list is read under.
const TASK_GROUP_LABEL_KEYS = {
  overdue: "groupOverdue",
  today: "groupToday",
  upcoming: "groupUpcoming",
  undated: "groupUndated",
} as const satisfies Record<TaskDueGroupKey, string>;

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

  // No description-only action here: the description is edited through the
  // same dialog as every other field of the task (updateTaskFieldsAction
  // below), because an expanded row that offered two pencils offered the same
  // edit twice.
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
    // The form carries the status too (the sheet's own segments), so a rep who
    // opens the dialog to fix a date can close the task in the same save. An
    // unreadable value is left alone rather than guessed at.
    const status = normalizeTaskStatus(formData.get("status"));

    const result = await updateTask(taskId, {
      title,
      description: description || null,
      isPriority,
      locationId: locationId || null,
      dueDate: dueDate || null,
      ...(status ? { status } : {}),
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
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(DONE_PAGE_SIZE),
    status: "done",
  });
  const hasFilters =
    selectedStatus !== "in_progress" ||
    selectedPriorityOnly ||
    selectedOverdueOnly;

  if (completedPeriod) {
    for (const [name, value] of Object.entries(
      periodSearchParams(completedPeriod, TASK_COMPLETED_PERIOD_PARAMS),
    )) {
      query.set(name, value);
    }
  }

  // The open list is always read whole and unfiltered, on both views. It is the
  // list on one of them, and on the other it is still what the filter row's
  // counts describe — a row that stops counting the moment the reader steps
  // into the done list is a row that stops being worth reading. The two
  // refinements narrow it here rather than at the API: overdue and priority are
  // both decidable from the tasks already in hand, and one request that answers
  // three questions beats three that each answer one.
  const openQuery = new URLSearchParams({
    pageSize: String(OPEN_PAGE_SIZE),
    status: "in_progress",
  });
  // What the rep has closed today, shown as a tail under the open list: an
  // empty list and an empty day are different answers, and the second one is
  // worth seeing at the end of a run.
  const closedTodayQuery = new URLSearchParams({
    pageSize: String(CLOSED_TODAY_PAGE_SIZE),
    status: "done",
    [TASK_COMPLETED_PERIOD_PARAMS.from]: todayIsoDate,
    [TASK_COMPLETED_PERIOD_PARAMS.to]: todayIsoDate,
  });

  const [openResult, doneResult, closedTodayResult, locationsResult] =
    await Promise.all([
      listTasks(openQuery.toString()),
      isDoneList ? listTasks(query.toString()) : null,
      // Only under the open list, and only when no refinement is on: a reader
      // narrowing to "overdue" asked a question the tail is no part of.
      isDoneList || selectedPriorityOnly || selectedOverdueOnly
        ? null
        : listTasks(closedTodayQuery.toString()),
      listLocations(),
    ]);
  // The list this view is about. The other request is context around it, and
  // its failure costs a count or a tail rather than the screen.
  const tasksResult = doneResult ?? openResult;

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

  // Every open task with its due state worked out once, since three different
  // readers need it: the filter row's counts, the overdue refinement and the
  // bands the list is drawn in.
  const openTasks = openResult.ok
    ? openResult.data.items.map((openTask) => ({
        task: openTask,
        due: describeTaskDue(openTask, todayIsoDate),
      }))
    : [];
  // Counts for the filter row. `null` where the open list failed to load — a
  // pill with no count says less than one with a wrong count.
  const openCounts = openResult.ok
    ? {
        open: openResult.data.total,
        overdue: openTasks.filter((entry) => entry.due.tone === "overdue")
          .length,
        priority: openTasks.filter((entry) => entry.task.isPriority).length,
      }
    : null;
  const visibleOpenTasks = openTasks
    .filter((entry) => !selectedOverdueOnly || entry.due.tone === "overdue")
    .filter((entry) => !selectedPriorityOnly || entry.task.isPriority)
    .map((entry) => entry.task);
  const closedTodayTasks =
    closedTodayResult?.ok === true ? closedTodayResult.data.items : [];
  const tasks = isDoneList ? tasksResult.data.items : visibleOpenTasks;
  // The task the sheet is open on, found among the ones this view already
  // holds. Deliberately not a fetch by id: the sheet is the detail of a row on
  // this screen, so an id that is not on it — stale link, another rep's task,
  // a filter that has since moved on — opens nothing at all.
  const openTask =
    (pageState.open &&
      [...tasks, ...closedTodayTasks].find(
        (candidate) => candidate.id === pageState.open,
      )) ||
    null;
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
  // The list exactly as it is being read right now — every filter, the period,
  // the page — and nothing that is about a one-off notice. Both the sheet's
  // link and its close target are built from it, so opening a task and closing
  // it again lands the reader back on the same list they left, rather than on
  // a reset one.
  const listParams = new URLSearchParams();

  for (const [name, value] of Object.entries(pageState)) {
    if (value && !NON_LIST_PARAMS.includes(name)) {
      listParams.set(name, value);
    }
  }

  const listHref = withParams(`/${tenantSlug}/field/tasks`, listParams);
  const sheetHref = (taskId: string) => {
    const params = new URLSearchParams(listParams);

    params.set("open", taskId);

    return withParams(`/${tenantSlug}/field/tasks`, params);
  };
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

      <section aria-label={t("listAria")} className="task-board">
        <FilterForm action={`/${tenantSlug}/field/tasks`}>
          {/* Finished work only accumulates, so the done list leads with how
              deep it reads. Open work needs no window — there are as many open
              tasks as there is work outstanding. */}
          {period ? (
            <ScrollStrip viewportClassName="task-filter-row">
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
            </ScrollStrip>
          ) : null}
          {/* One strip, in the order it is read: the open list, the two
              questions asked of it, then the finished list at the far end.
              Written out here rather than assembled from FilterPills and
              FilterTogglePills, which cannot interleave — the refinements sit
              *inside* the status choice they narrow, and putting the two
              components side by side would push "done" between a filter and
              the list it filters. The names and values are theirs, so the form,
              the reset and the URL stay exactly as before.

              The counts are what make the strip worth reading: a rep learns
              how much is open, how much of it is late and how much is flagged
              without opening any of the three. */}
          <ScrollStrip>
            <div
              aria-label={t("filtersAria")}
              className="filter-pills task-filter-row"
              role="group"
            >
              <label>
                <input
                  defaultChecked={selectedStatus === "in_progress"}
                  name="status"
                  type="radio"
                  value="in_progress"
                />
                <span>
                  {formatEnumLabel(tCommon, "in_progress")}
                  <FilterCount value={openCounts?.open} />
                </span>
              </label>
              {/* The refinements narrow the open list and nothing else, so they
                stand down on the done view rather than sitting there inert. */}
              {isDoneList ? null : (
                <>
                  <label className="filter-pill--overdue">
                    <input
                      defaultChecked={selectedOverdueOnly}
                      name="overdue"
                      type="checkbox"
                      value="1"
                    />
                    <span>
                      {t("overdueFilter")}
                      <FilterCount value={openCounts?.overdue} />
                    </span>
                  </label>
                  <label className="filter-pill--priority">
                    <input
                      defaultChecked={selectedPriorityOnly}
                      name="priority"
                      type="checkbox"
                      value="1"
                    />
                    <span>
                      {t("priorityFilter")}
                      <FilterCount value={openCounts?.priority} />
                    </span>
                  </label>
                </>
              )}
              <label>
                <input
                  defaultChecked={isDoneList}
                  name="status"
                  type="radio"
                  value="done"
                />
                {/* No count: the done list is read through a window, so any
                  number here would be a count of a period nobody named yet. */}
                <span>{formatEnumLabel(tCommon, "done")}</span>
              </label>
            </div>
          </ScrollStrip>

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
            {/* The open list is read in bands — late, today, ahead, undated —
                because those four are the only questions a rep asks of it, and
                a flat list makes each one a scan. The done list is already one
                band by definition (finished, inside the chosen window), so it
                stays flat rather than growing a heading that says what the
                period line above it just said. */}
            {isDoneList ? (
              <TaskRows
                entries={tasks.map((doneTask) => ({
                  task: doneTask,
                  due: describeTaskDue(doneTask, todayIsoDate),
                }))}
                sheetHref={sheetHref}
              />
            ) : (
              groupTasksByDue(tasks, todayIsoDate).map((group) => (
                <TaskGroup
                  count={group.entries.length}
                  key={group.key}
                  label={t(TASK_GROUP_LABEL_KEYS[group.key])}
                  tone={group.key}
                >
                  <TaskRows entries={group.entries} sheetHref={sheetHref} />
                </TaskGroup>
              ))
            )}
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

        {/* Closed today, under the open list rather than inside it: it is not
            work to do, it is the answer to "did I get anywhere today", and a
            rep who has cleared the list sees the day rather than an empty
            screen. */}
        {closedTodayTasks.length > 0 ? (
          <TaskGroup
            count={closedTodayTasks.length}
            label={t("groupClosedToday")}
            tone="closed"
          >
            <TaskRows
              entries={closedTodayTasks.map((closedTask) => ({
                task: closedTask,
                due: describeTaskDue(closedTask, todayIsoDate),
              }))}
              sheetHref={sheetHref}
            />
          </TaskGroup>
        ) : null}

        {/* Opened by ?open=<taskId>, which is what makes the phone's back
            gesture close it. Only ever a task that is on the screen behind it:
            an id from another list, another rep or a stale link opens nothing
            rather than fetching a task this view was not showing. */}
        {openTask ? (
          <TaskSheet
            ariaLabel={openTask.title}
            closeHref={listHref}
            closeLabel={tCommon("close")}
            eyebrow={
              openTask.isPriority ? (
                <span className="task-sheet-priority">
                  <FlagIcon />
                  {t("priority")}
                </span>
              ) : null
            }
          >
            <TaskSheetBody
              due={describeTaskDue(openTask, todayIsoDate)}
              format={format}
              locationOptions={locationOptions}
              t={t}
              tCommon={tCommon}
              task={openTask}
              todayIsoDate={todayIsoDate}
              updateTaskFieldsAction={updateTaskFieldsAction}
              updateTaskStatusAction={updateTaskStatusAction}
            />
          </TaskSheet>
        ) : null}
      </section>
    </AppShell>
  );
}

// A count riding inside a filter pill. Absent rather than zero when the list it
// counts failed to load: "0 overdue" is an answer, and this would be a guess.
function FilterCount({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return null;
  }

  return <b className="filter-pill-count">{value}</b>;
}

// One band of the list under its own heading — late, today, ahead, undated, or
// the day's finished work. The count belongs in the heading because it is the
// answer to the question the heading asks.
function TaskGroup({
  children,
  count,
  label,
  tone,
}: {
  children: ReactNode;
  count: number;
  label: string;
  tone: TaskDueGroupKey | "closed";
}) {
  return (
    <section className={`task-group is-${tone}`}>
      <h2 className="task-group-head">
        <span className="task-group-name">{label}</span>
        <span className="task-group-count">{count}</span>
      </h2>
      {children}
    </section>
  );
}

// One row per task, built around a date rail: the deadline is the same size in
// the same place on every row, so the list reads as one column of dates rather
// than as a stack of cards each stating its own.
//
// A row is what a rep scans — the date, the title, how late it is, where it is
// — and nothing else: everything about the task, and every action on it, is in
// the sheet the row opens.
function TaskRows({
  entries,
  sheetHref,
}: {
  entries: { task: Task; due: TaskDueState }[];
  sheetHref: (taskId: string) => string;
}) {
  const t = useTranslations("field.tasks");
  const format = useFormatter();

  return (
    <ul className="task-rows">
      {entries.map(({ task, due }) => (
        <li
          className={`task-row is-${due.tone}${
            task.isPriority ? " is-priority" : ""
          }`}
          id={`task-${task.id}`}
          key={task.id}
        >
          {/* A link, not a button: the sheet it opens is a URL, so the whole
              row is one ordinary navigation — long-press, middle-click and the
              back gesture all behave the way the phone already taught. */}
          <a className="task-row-main" href={sheetHref(task.id)}>
            <TaskDueRail due={due} format={format} t={t} />
            <span className="task-row-text">
              <span className="task-row-title">{task.title}</span>
              <span className="task-row-meta">
                {due.tone === "overdue" && due.dayOffset !== null ? (
                  <b className="task-row-late">
                    {t("rowOverdueDays", { days: -due.dayOffset })}
                  </b>
                ) : null}
                <span className="task-row-place">
                  <MapPinIcon />
                  {task.location
                    ? `${task.location.name}, ${task.location.city}`
                    : t("noLocation")}
                </span>
              </span>
              {/* The gold edge says this to everyone who can see it. */}
              {task.isPriority ? (
                <span className="sr-only">{t("priority")}</span>
              ) : null}
            </span>
            <ChevronRightIcon />
          </a>
        </li>
      ))}
    </ul>
  );
}

// The row's left column. Everything visible in it is aria-hidden and replaced
// by one spoken sentence: read out piecemeal it announces "3, Jul", which is
// two fragments where the reader needs one fact.
function TaskDueRail({
  due,
  format,
  t,
}: {
  due: TaskDueState;
  format: IntlFormatter;
  t: FieldTasksTranslator;
}) {
  if (!due.dueAt || due.dayOffset === null) {
    return (
      <span className="task-row-rail">
        <span className="sr-only">{t("dueAriaNone")}</span>
        <span aria-hidden="true" className="task-row-rail-label">
          {t("dueNone")}
        </span>
      </span>
    );
  }

  const date = formatDueDate(format, due.dueAt, { dateStyle: "medium" });

  return (
    <span className="task-row-rail">
      <span className="sr-only">
        {due.tone === "overdue"
          ? t("dueAriaOverdue", { date, days: -due.dayOffset })
          : due.tone === "today"
            ? t("dueAriaToday", { date })
            : t("dueAria", { date })}
      </span>
      <span aria-hidden="true" className="task-row-day">
        {formatDueDate(format, due.dueAt, { day: "numeric" })}
      </span>
      <span aria-hidden="true" className="task-row-month">
        {formatDueMonth(format, due.dueAt)}
      </span>
    </span>
  );
}

type FieldTasksTranslator = Awaited<
  ReturnType<typeof getTranslations<"field.tasks">>
>;
type CommonTranslator = Awaited<ReturnType<typeof getTranslations<"common">>>;

// Everything the sheet says about one task, and every action on it. Rendered
// on the server and handed to TaskSheet as children — the sheet itself only
// owns the gesture, the backdrop and the way it closes.
function TaskSheetBody({
  format,
  locationOptions,
  t,
  tCommon,
  task,
  due,
  todayIsoDate,
  updateTaskFieldsAction,
  updateTaskStatusAction,
}: {
  format: IntlFormatter;
  locationOptions: { id: string; label: string }[];
  t: FieldTasksTranslator;
  tCommon: CommonTranslator;
  task: Task;
  due: TaskDueState;
  todayIsoDate: string;
  updateTaskFieldsAction: (formData: FormData) => Promise<EditTaskActionResult>;
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
}) {
  const finished = task.status === "done";

  return (
    <>
      <div className="task-sheet-head">
        <h2 className="task-sheet-title">{task.title}</h2>
        {task.description ? (
          <p className="task-sheet-description">{task.description}</p>
        ) : null}
      </div>

      {/* Three facts, not four: who set the task is the first line of the
          history below, and a sheet this short cannot afford to say the same
          name twice. */}
      <dl className="task-sheet-facts">
        <div>
          <dt>{t("factStatus")}</dt>
          <dd>{formatEnumLabel(tCommon, task.status)}</dd>
        </div>
        <div>
          <dt>{t("factDue")}</dt>
          <dd className={`task-sheet-due is-${due.tone}`}>
            <TaskSheetDue due={due} format={format} t={t} />
          </dd>
        </div>
        <div>
          <dt>{t("factLocation")}</dt>
          <dd>
            {task.location
              ? `${task.location.name}, ${task.location.city}`
              : t("noLocation")}
          </dd>
        </div>
      </dl>

      <TaskHistoryList
        createdAt={task.createdAt}
        createdByName={task.createdBy?.name ?? null}
        format={format}
        history={task.history}
        t={t}
        tCommon={tCommon}
      />

      <div className="task-sheet-actions">
        {/* The whole point of opening a task on a route: one tap to close it
            out. Finishing sends the rep back to the list, where the task has
            moved to "closed today" and the confirmation says so. */}
        <form action={updateTaskStatusAction}>
          <input name="taskId" type="hidden" value={task.id} />
          <input
            name="status"
            type="hidden"
            value={finished ? "in_progress" : "done"}
          />
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={t(finished ? "sheetReopening" : "sheetCompleting")}
          >
            {t(finished ? "sheetReopen" : "sheetComplete")}
          </PendingSubmitButton>
        </form>
        <EditTaskModal
          action={updateTaskFieldsAction}
          locationOptions={locationOptions}
          task={task}
          todayIsoDate={todayIsoDate}
          triggerLabel={t("sheetEdit")}
        />
      </div>
    </>
  );
}

// The deadline as the sheet states it: the day written out with its weekday —
// a date a rep has to act on is a day of the week first — plus how late it is
// when that has already passed.
function TaskSheetDue({
  due,
  format,
  t,
}: {
  due: TaskDueState;
  format: IntlFormatter;
  t: FieldTasksTranslator;
}) {
  if (!due.dueAt || due.dayOffset === null) {
    return <>{t("dueNone")}</>;
  }

  const date = formatDueDate(format, due.dueAt, {
    day: "numeric",
    month: "short",
    weekday: "short",
  });

  if (due.tone === "overdue") {
    return (
      <>
        {date}
        <span className="task-sheet-late">
          {t("rowOverdueDays", { days: -due.dayOffset })}
        </span>
      </>
    );
  }

  return <>{date}</>;
}

// Read-only: who created the task (always known, even for tasks that predate
// this feature) plus every recorded status change, oldest first. Tasks from
// before the history table existed simply have an empty `history` array, so
// they fall back to showing only the creation line — exactly the intended
// behavior. Laid out as a timeline: the stamp on the left, what happened and
// who did it on the right, so a column of dates reads down the edge.
function TaskHistoryList({
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
  // "created" entry below, so only real transitions show as history rows.
  const statusChanges = history.filter((entry) => entry.oldStatus !== null);

  return (
    <section className="task-sheet-history">
      <h3>{t("historyTitle")}</h3>
      <ol>
        <TaskHistoryEntry
          at={createdAt}
          by={createdByName ?? tCommon("unknown")}
          event={t("historyCreatedEvent")}
          format={format}
        />
        {statusChanges.map((entry) => (
          <TaskHistoryEntry
            at={entry.createdAt}
            by={entry.changedBy?.name ?? tCommon("unknown")}
            event={t("historyStatusEvent", {
              status: formatEnumLabel(tCommon, entry.newStatus),
            })}
            format={format}
            key={entry.id}
          />
        ))}
      </ol>
    </section>
  );
}

function TaskHistoryEntry({
  at,
  by,
  event,
  format,
}: {
  at: string;
  by: string;
  event: string;
  format: IntlFormatter;
}) {
  const moment = new Date(at);

  return (
    <li>
      <time dateTime={at}>
        <span>
          {format.dateTime(moment, { day: "2-digit", month: "2-digit" })}
        </span>
        <span>
          {format.dateTime(moment, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </time>
      <div>
        <b>{event}</b>
        <span>{by}</span>
      </div>
    </li>
  );
}

// Several locales abbreviate short month names with a trailing dot (uk and
// fr among them). The rail sets the month in uppercase under a large day
// number, where that dot reads as dirt on the screen, not as punctuation.
function formatDueMonth(format: IntlFormatter, dueAt: Date): string {
  return formatDueDate(format, dueAt, { month: "short" }).replace(/\.$/, "");
}

function withParams(path: string, params: URLSearchParams): string {
  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

function normalizeTaskStatus(
  value: FormDataEntryValue | string | null | undefined,
): TaskStatus | null {
  if (value === "in_progress" || value === "done") {
    return value;
  }

  return null;
}
