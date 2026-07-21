import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import { CardFact } from "../../../../components/card-fact";
import {
  CreateOwnTaskModal,
  type CreateOwnTaskActionResult,
} from "../../../../components/create-own-task-modal";
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
} from "../../../../components/icons";
import { TaskDetailsEditor } from "../../../../components/task-details-editor";
import { TaskStatusEditor } from "../../../../components/task-status-editor";
import {
  createTask,
  getCurrentSession,
  listLocations,
  listTasks,
  updateTask,
  type Task,
  type TaskStatus,
  type TaskStatusHistoryEntry,
} from "../../../../lib/api-client";
import { buildLocationOptions } from "../../../../lib/filter-options";
import {
  formatEnumLabel,
  normalizeFilterValue,
  type IntlFormatter,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { parseTaskIsPriorityInput } from "../../../../lib/task-form";
import { isTaskUnfinished, taskStatuses } from "../../../../lib/task-status";

type FieldTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    create?: string;
    dueFrom?: string;
    dueTo?: string;
    error?: string;
    locationId?: string;
    priority?: string;
    status?: string;
    task?: string;
  }>;
};

export default async function FieldTasksPage({
  params,
  searchParams,
}: FieldTasksPageProps) {
  const { tenantSlug } = await params;
  const [locale, timeZone, t, tField, tCreateTask, tCommon] = await Promise.all(
    [
      getLocale(),
      getTimeZone(),
      getTranslations("field.tasks"),
      getTranslations("field"),
      getTranslations("field.createTask"),
      getTranslations("common"),
    ],
  );
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
  const selectedStatus = normalizeTaskStatus(pageState.status);
  const selectedPriorityOnly = pageState.priority === "1";
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const dueFrom = normalizeDateFilter(pageState.dueFrom);
  const dueTo = normalizeDateFilter(pageState.dueTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedPriorityOnly ||
    selectedLocationId ||
    dueFrom ||
    dueTo,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedPriorityOnly) {
    query.set("isPriority", "true");
  }

  if (selectedLocationId) {
    query.set("locationId", selectedLocationId);
  }

  if (dueFrom) {
    query.set("dueFrom", dueFrom);
  }

  if (dueTo) {
    query.set("dueTo", dueTo);
  }

  const [tasksResult, locationsResult] = await Promise.all([
    listTasks(query.toString()),
    listLocations(),
  ]);

  if (!tasksResult.ok) {
    return (
      <AppShell activeArea="field-tasks" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              {tField("backToRoute")}
            </a>
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
      <header className="page-header">
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
          body={t("taskCreatedBody")}
          clearParams={["task"]}
          eyebrow={t("taskCreatedEyebrow")}
          title={t("taskCreatedTitle")}
          tone="success"
        />
      ) : null}

      {task === "updated" ? (
        <DismissableNotice
          ariaLabel={t("taskStatusAria")}
          body={t("taskUpdatedBody")}
          clearParams={["task"]}
          eyebrow={t("taskUpdatedEyebrow")}
          title={t("taskUpdatedTitle")}
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
                  hasFilters ? `/${tenantSlug}/field/tasks` : undefined
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
            updateTaskDetailsAction={updateTaskDetailsAction}
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
                  href={`/${tenantSlug}/field/tasks`}
                >
                  {t("showAll")}
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
              <TaskStatusEditor
                ariaLabel={t("updateTaskStatusAria", { title: task.title })}
                status={task.status}
                taskId={task.id}
                updateAction={updateTaskStatusAction}
              />
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

function normalizeTaskStatus(
  value: FormDataEntryValue | string | null | undefined,
): TaskStatus | null {
  if (value === "in_progress" || value === "done") {
    return value;
  }

  return null;
}

function normalizeDateFilter(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
