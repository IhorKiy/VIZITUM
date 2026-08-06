import type { ReactNode } from "react";
import Link from "next/link";
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
import { resolveBackTarget } from "../../../../../lib/back-navigation";
import {
  CreateOwnTaskModal,
  type CreateOwnTaskActionResult,
} from "../../../../../components/create-own-task-modal";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import {
  EditTaskModal,
  type EditTaskActionResult,
} from "../../../../../components/edit-task-modal";
import { FilterForm } from "../../../../../components/filter-form";
import {
  CalendarDashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FlagIcon,
  MapPinIcon,
} from "../../../../../components/icons";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import { ScrollStrip } from "../../../../../components/scroll-strip";
import { TaskSheet } from "../../../../../components/task-sheet";
import {
  TaskStickyBar,
  type StickyFilterChip,
} from "../../../../../components/task-sticky-bar";
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
  normalizePage,
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
    create?: string;
    error?: string;
    overdue?: string;
    page?: string;
    // Where this screen was opened from, resolved into its back control. The
    // location card's task deep link is the journey this exists for (audit
    // F17); a bookmark or a menu tap carries none and falls back to the field
    // home.
    from?: string;
    // The task whose sheet is open, by id.
    open?: string;
    priority?: string;
    status?: string;
    task?: string;
  }>;
};

// The finished list is read straight through, newest first, a page at a time —
// no date window over it. A rep looking for something they closed knows roughly
// how long ago, and stepping back a page at a time is how they find it; naming
// the range it fell in first was a question to answer before the list would
// even show. Twenty is a phone screenful and change: enough that paging is
// rare, few enough that the page never becomes its own scroll.
const DONE_PAGE_SIZE = 20;
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
// The other half of that split, as an allowlist rather than the complement:
// the list query travels back to the server on the sheet's forms, so what
// comes off a form is read against the names this page actually understands
// instead of being trusted whole — a hand-edited field must not be able to
// smuggle `error=task` into the address a save redirects to.
// `from` rides along so a save does not strand the reader: without it, editing
// a task opened from a location card returns them to the field home instead of
// that outlet — the link half of audit F17 fixed on its own would still drop
// the origin on every update. It is safe to take off a form for the reason the
// rest of this list is not read whole: `resolveBackTarget` checks the value
// against RETURNABLE_SCREENS, the caller's zone and the tenant prefix, so a
// hand-edited field can only make the back control fall back.
const LIST_PARAMS = ["from", "overdue", "page", "priority", "status"];

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
  const [locale, timeZone, format, t, tBack, tField, tCreateTask, tCommon] =
    await Promise.all([
      getLocale(),
      getTimeZone(),
      getFormatter(),
      getTranslations("field.tasks"),
      getTranslations("common.back"),
      getTranslations("field"),
      getTranslations("field.createTask"),
      getTranslations("common"),
    ]);
  // Due dates are date-only "YYYY-MM-DD" strings; "overdue" must be judged
  // against today's date in the tenant timezone, not the server's local
  // midnight (mirrors manager/tasks/page.tsx).
  const todayIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(),
  );

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    // Where the rep was reading when they acted, carried on the form (see
    // listQueryFrom): a save that landed them on a reset list would throw away
    // the window, the page and the refinements they had picked.
    const listQuery = listQueryFrom(formData);
    const taskId = getFormString(formData, "taskId").trim();
    const status = normalizeTaskStatus(formData.get("status"));

    if (!taskId || !status) {
      redirect(tasksHref(tenantSlug, listQuery, "error", "task"));
    }

    const result = await updateTask(taskId, { status });

    if (!result.ok) {
      redirect(tasksHref(tenantSlug, listQuery, "error", "task"));
    }

    redirect(tasksHref(tenantSlug, listQuery, "task", "updated"));
  }

  // No description-only action here: the description is edited through the
  // same dialog as every other field of the task (updateTaskFieldsAction
  // below), because an expanded row that offered two pencils offered the same
  // edit twice.
  async function updateTaskFieldsAction(
    formData: FormData,
  ): Promise<EditTaskActionResult> {
    "use server";

    const listQuery = listQueryFrom(formData);
    const taskId = getFormString(formData, "taskId").trim();

    if (!taskId) {
      redirect(tasksHref(tenantSlug, listQuery, "error", "task"));
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

    redirect(tasksHref(tenantSlug, listQuery, "task", "edited"));
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
  // Reachable from the bottom nav, the field menu and a location card's task
  // list, so it cannot name one destination without stranding the others —
  // the rule CLAUDE.md states for exactly this shape. The field home is the
  // hierarchical fallback for a deep link that carries no origin.
  const backTarget = resolveBackTarget(tenantSlug, pageState.from, {
    href: `/${tenantSlug}/field`,
    labelKey: "home",
  });
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
  // Finished tasks only ever accumulate, so that list is paged: newest first,
  // DONE_PAGE_SIZE at a time, all the way back to the first task this rep ever
  // closed. No date window over it — see DONE_PAGE_SIZE.
  const isDoneList = selectedStatus === "done";
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
        <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
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
  // Whether this rep holds more open work than one read of the list returns.
  // Self-limiting as open work is, OPEN_PAGE_SIZE is the API's ceiling rather
  // than a promise, and everything below — the bands, the refinements, the
  // counts — describes the tasks actually in hand.
  const openTasksTruncated =
    openResult.ok && openResult.data.items.length < openResult.data.total;
  // Counts for the filter row. `null` where the open list failed to load — a
  // pill with no count says less than one with a wrong count. All three count
  // the same set: taking the open one from the server's total instead would
  // have it describe every open task while the two beside it described only
  // the first hundred, and a strip whose three numbers disagree is worse than
  // one that admits its limit (the note under it does).
  const openCounts = openResult.ok
    ? {
        open: openTasks.length,
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
  const totalPages = tasksResult.data.totalPages;
  // An empty finished list is now an empty history and nothing else: with no
  // window over it, there is no narrow range left to blame, and the words for
  // the two cases are different. Guarded on page 1 so a stale ?page=9 — a
  // bookmark, a back button after a task was reopened — reads as a page past
  // the end rather than as a rep who has never finished anything.
  const noneEverCompleted = isDoneList && tasks.length === 0 && page === 1;
  // The list exactly as it is being read right now — every filter and the
  // page — and nothing that is about a one-off notice. Both the sheet's
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

  // The filter row as the collapsed bar draws it: the same four filters with
  // the same on/off state, as links rather than form controls. The bar sits
  // outside the filter form (it is fixed to the viewport, the form is in the
  // page), and duplicating the checkboxes inside it would put two controls of
  // the same name in one form — which serializes `overdue=1&overdue=1` and
  // reads back as no filter at all. Links carry the state where it actually
  // lives, in the URL.
  const filterHref = (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();

    return query
      ? `/${tenantSlug}/field/tasks?${query}`
      : `/${tenantSlug}/field/tasks`;
  };
  // What the open list's refinements currently are, as URL parameters — the
  // pair every chip has to carry so switching one filter never silently drops
  // the other, exactly as the checkboxes behave.
  const activeRefinements: Record<string, string> = {
    ...(selectedOverdueOnly ? { overdue: "1" } : {}),
    ...(selectedPriorityOnly ? { priority: "1" } : {}),
  };
  // A chip for a refinement that is already on turns it off again, the way
  // tapping a checked checkbox does. Removed rather than emptied: `overdue=`
  // is a parameter the page would carry around and never read.
  const toggleRefinementHref = (name: "overdue" | "priority", on: boolean) => {
    const params = { ...activeRefinements };

    if (on) {
      delete params[name];
    } else {
      params[name] = "1";
    }

    return filterHref(params);
  };
  const stickyChips: StickyFilterChip[] = [
    {
      active: !isDoneList,
      count: openCounts?.open,
      // Keeps the refinements, the way clicking the already-checked radio in
      // the full row does nothing to the two checkboxes beside it.
      href: filterHref(activeRefinements),
      key: "in_progress",
      label: formatEnumLabel(tCommon, "in_progress"),
    },
    {
      active: selectedOverdueOnly,
      count: openCounts?.overdue,
      href: toggleRefinementHref("overdue", selectedOverdueOnly),
      key: "overdue",
      label: t("overdueFilter"),
      tone: "overdue",
    },
    {
      active: selectedPriorityOnly,
      count: openCounts?.priority,
      href: toggleRefinementHref("priority", selectedPriorityOnly),
      key: "priority",
      label: t("priorityFilter"),
      tone: "priority",
    },
    {
      active: isDoneList,
      // No count, for the reason the full row gives: the finished list is read
      // a page at a time, and a number here would count more than is on screen.
      href: filterHref({ status: "done" }),
      key: "done",
      label: formatEnumLabel(tCommon, "done"),
    },
  ];

  return (
    <AppShell
      activeArea="field-tasks"
      // The brand row scrolls away with the header it belongs to: the top edge
      // here is taken by this screen's own collapsed bar (TaskStickyBar), and
      // only one of the two can hold it.
      scrollingTopbar
      tenantSlug={tenantSlug}
    >
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
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
        {/* The filter row, and the collapsed bar that takes over once it has
            scrolled away. The bar holds the row so it can watch it — see
            TaskStickyBar. */}
        <TaskStickyBar
          ariaLabel={t("stickyFiltersAria")}
          chips={stickyChips}
          scrollTopLabel={t("backToTop")}
          title={t("title")}
        >
          <FilterForm action={`/${tenantSlug}/field/tasks`}>
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
                {/* The refinements narrow the open list and nothing else: a done
                  task is never overdue, and "flagged" is a question about work
                  still outstanding. They stay in the row on both views all the
                  same — a strip that drops half its pills the moment the
                  finished list is opened reads as a different screen rather
                  than as the same one, filtered differently.

                  On the finished view they are links back to the open list
                  carrying the refinement, rather than checkboxes that would
                  tick and then be ignored (see selectedOverdueOnly). Their
                  counts need no view of their own: both count the open list,
                  which is read on both views. */}
                {isDoneList ? (
                  <>
                    <a
                      className="filter-pill--overdue"
                      href={`/${tenantSlug}/field/tasks?overdue=1`}
                    >
                      {t("overdueFilter")}
                      <FilterCount value={openCounts?.overdue} />
                    </a>
                    <a
                      className="filter-pill--priority"
                      href={`/${tenantSlug}/field/tasks?priority=1`}
                    >
                      {t("priorityFilter")}
                      <FilterCount value={openCounts?.priority} />
                    </a>
                  </>
                ) : (
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
                  {/* No count: the finished list is read a page at a time, so a
                  number here would count far more than is ever on screen. The
                  total is stated above the page instead, where it is the
                  denominator the pagination line counts against. */}
                  <span>{formatEnumLabel(tCommon, "done")}</span>
                </label>
              </div>
            </ScrollStrip>

            {/* Said out loud rather than left for a rep to notice: with more open
              work than one read returns, every number and every band above
              covers the first page of it and nothing else. */}
            {openTasksTruncated && !isDoneList ? (
              <p className="task-board-note">
                {t("openListTruncated", { count: openTasks.length })}
              </p>
            ) : null}
          </FilterForm>
        </TaskStickyBar>

        {/* How much finished work there is in total, above the page of it on
            screen — the denominator the pagination line below counts pages
            against. */}
        {isDoneList && tasks.length > 0 ? (
          <p className="list-count-summary">
            <strong>{t("doneCount", { count: tasksResult.data.total })}</strong>
          </p>
        ) : null}

        {tasks.length > 0 ? (
          <>
            {/* The open list is read in bands — late, today, ahead, undated —
                because those four are the only questions a rep asks of it, and
                a flat list makes each one a scan. The done list is already one
                band by definition — finished, newest first — so it stays flat
                rather than growing headings for a question nobody asks of it. */}
            {isDoneList ? (
              <TaskRows
                entries={tasks.map((doneTask) => ({
                  task: doneTask,
                  due: describeTaskDue(doneTask, todayIsoDate),
                }))}
                sheetHref={sheetHref}
              />
            ) : (
              groupTasksByDue(tasks, todayIsoDate).map((group, _index, all) => (
                <TaskGroup
                  // Undated work folds away — but only while there is dated
                  // work above it to fold away *for*. A rep whose whole list is
                  // undated would otherwise open the screen on a single closed
                  // line and no tasks at all.
                  collapsed={group.key === "undated" && all.length > 1}
                  count={group.entries.length}
                  key={group.key}
                  label={t(TASK_GROUP_LABEL_KEYS[group.key])}
                  tone={group.key}
                >
                  <TaskRows entries={group.entries} sheetHref={sheetHref} />
                </TaskGroup>
              ))
            )}
            {/* The whole of the reaching-back mechanism: newer, where you are,
                earlier. It runs to the first task this rep ever closed, so the
                last page is simply the one with no "earlier" on it. */}
            {isDoneList && totalPages > 1 ? (
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
          </>
        ) : (
          <div className="empty-state-panel">
            {/* An empty filter and an empty history are different answers and
                get different words. "Nothing matches this filter" is true of a
                refinement that happens to select nothing; it is wrong for a rep
                who has never finished anything, where no filter will ever
                help. */}
            <h2>
              {noneEverCompleted ? t("emptyDoneEverTitle") : t("emptyTitle")}
            </h2>
            <p>{noneEverCompleted ? t("emptyDoneEverBody") : t("emptyBody")}</p>
            <div className="toolbar">
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
              listQuery={listParams.toString()}
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

      {/* The dialog only — its button is the bottom nav's, on every field
          screen (components/field-create-fab.tsx), and reaches this through
          `?create=1`. Mounted here because this is the screen that has the
          rep's assigned locations and the create action; rendered after the
          list because a dialog belongs at the end of the document. */}
      <CreateOwnTaskModal
        action={createTaskAction}
        locationOptions={assignedLocationOptions}
        todayIsoDate={todayIsoDate}
      />
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
  collapsed = false,
  count,
  label,
  tone,
}: {
  children: ReactNode;
  // Renders the band folded behind its own heading. Undated work uses it: it
  // is the band a rep reaches for last — nothing in it is owed on any day — yet
  // it is also the one that grows without bound, so left open it pushes the
  // dated work a rep came for off the screen.
  collapsed?: boolean;
  count: number;
  label: string;
  tone: TaskDueGroupKey | "closed";
}) {
  const head = (
    <>
      <span className="task-group-name">{label}</span>
      <span className="task-group-count">{count}</span>
    </>
  );

  // A native disclosure rather than a toggle of our own: it opens without
  // JavaScript, the phone's find-in-page opens it to show a match, and the
  // heading stays one tap tall.
  if (collapsed) {
    return (
      <details className={`task-group task-group--foldable is-${tone}`}>
        <summary className="task-group-head">
          {head}
          <span aria-hidden="true" className="task-group-chevron">
            <ChevronDownIcon />
          </span>
        </summary>
        {children}
      </details>
    );
  }

  return (
    <section className={`task-group is-${tone}`}>
      <h2 className="task-group-head">{head}</h2>
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
              back gesture all behave the way the phone already taught. Routed
              through Link rather than a bare <a> so opening the sheet is a
              client transition, and scroll={false} so the list stays where the
              reader left it — the mirror of the router.replace the sheet
              closes with. */}
          <Link
            className="task-row-main"
            href={sheetHref(task.id)}
            scroll={false}
          >
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
          </Link>
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
        <CalendarDashIcon />
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
  listQuery,
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
  // The current list as a query string, threaded down to the two forms so a
  // save returns to the same list rather than to a reset one.
  listQuery: string;
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
      {/* Everything above the actions scrolls as one: the title and the
          description are as long as the rep who wrote them made them, and with
          only the history scrolling a wordy task pushed "Complete" — the whole
          reason the sheet opens — off the bottom of a small screen. */}
      <div className="task-sheet-body">
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
      </div>

      <div className="task-sheet-actions">
        {/* The whole point of opening a task on a route: one tap to close it
            out. Finishing sends the rep back to the list, where the task has
            moved to "closed today" and the confirmation says so.

            The button carries the status word it writes — "Done", the same
            word the status row above it and the edit sheet's own segment
            use — rather than a synonym for the act of writing it. */}
        <form action={updateTaskStatusAction}>
          <input name="taskId" type="hidden" value={task.id} />
          <input
            name="status"
            type="hidden"
            value={finished ? "in_progress" : "done"}
          />
          {/* The list this was submitted from, so the redirect can land back
              on it. Carried on the form rather than closed over by the action:
              a Server Action captures what it closes over at build time, and
              this is per-request. */}
          <input name="listQuery" type="hidden" value={listQuery} />
          <PendingSubmitButton
            className="primary-button"
            pendingLabel={t(finished ? "sheetReopening" : "sheetCompleting")}
          >
            {t(finished ? "sheetReopen" : "sheetComplete")}
          </PendingSubmitButton>
        </form>
        <EditTaskModal
          action={updateTaskFieldsAction}
          listQuery={listQuery}
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
        {/* Its own wording rather than the row's: in the list the count sits
            under a heading that already says "Overdue", while here it follows
            a date, where a bare "3 days" reads just as easily as three days
            from now. */}
        <span className="task-sheet-late">
          {t("dueOverdueBy", { days: -due.dayOffset })}
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

// The list a submitted form came from, as this page understands it.
function listQueryFrom(formData: FormData): URLSearchParams {
  const submitted = new URLSearchParams(getFormString(formData, "listQuery"));
  const listQuery = new URLSearchParams();

  for (const name of LIST_PARAMS) {
    const value = submitted.get(name);

    if (value) {
      listQuery.set(name, value);
    }
  }

  return listQuery;
}

// That list, plus the one notice this redirect is carrying.
function tasksHref(
  tenantSlug: string,
  listQuery: URLSearchParams,
  noticeName: string,
  noticeValue: string,
): string {
  const params = new URLSearchParams(listQuery);

  params.set(noticeName, noticeValue);

  return withParams(`/${tenantSlug}/field/tasks`, params);
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
