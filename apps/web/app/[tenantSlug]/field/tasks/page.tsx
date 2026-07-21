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
import { FilterPills } from "../../../../components/filter-pills";
import {
  CalendarIcon,
  FlagIcon,
  MapPinIcon,
} from "../../../../components/icons";
import { TaskDetailsEditor } from "../../../../components/task-details-editor";
import { TaskStatusEditor } from "../../../../components/task-status-editor";
import {
  getCurrentSession,
  listLocations,
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../../lib/api-client";
import { buildLocationOptions } from "../../../../lib/filter-options";
import {
  formatEnumLabel,
  normalizeFilterValue,
  type IntlFormatter,
} from "../../../../lib/format";
import { getFormString } from "../../../../lib/form";
import { taskStatuses } from "../../../../lib/task-status";

type FieldTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    dueFrom?: string;
    dueTo?: string;
    error?: string;
    locationId?: string;
    priority?: string;
    status?: string;
    task?: string;
  }>;
};

const taskPriorities: TaskPriority[] = ["high", "normal", "low"];

export default async function FieldTasksPage({
  params,
  searchParams,
}: FieldTasksPageProps) {
  const { tenantSlug } = await params;
  const [locale, timeZone, t, tField, tCommon] = await Promise.all([
    getLocale(),
    getTimeZone(),
    getTranslations("field.tasks"),
    getTranslations("field"),
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

  const pageState = await searchParams;
  const { task, error } = pageState;
  const selectedStatus = normalizeTaskStatus(pageState.status);
  const selectedPriority = normalizeTaskPriority(pageState.priority);
  const selectedLocationId = normalizeFilterValue(pageState.locationId);
  const dueFrom = normalizeDateFilter(pageState.dueFrom);
  const dueTo = normalizeDateFilter(pageState.dueTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedPriority ||
    selectedLocationId ||
    dueFrom ||
    dueTo,
  );

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedPriority) {
    query.set("priority", selectedPriority);
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

  return (
    <AppShell activeArea="field-tasks" tenantSlug={tenantSlug}>
      <header className="page-header">
        <div>
          <h1>{t("title")}</h1>
        </div>
      </header>

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
            {hasFilters ? (
              <div className="toolbar">
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/field/tasks`}
                >
                  {t("showAll")}
                </a>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}

// One card layout at every width, matching manager/tasks/page.tsx's
// TasksCards: the status pill doubles as the inline editor (click to change
// it, saves on pick), and the description lives behind the "details"
// disclosure. Own-scope tasks have no assignee to show and no team-delete
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
              <h3 className="list-card-title">{task.title}</h3>
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
              <CardFact icon={<FlagIcon />} label={t("priority")}>
                <PriorityTag
                  label={formatEnumLabel(tCommon, task.priority)}
                  priority={task.priority}
                />
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

function formatDate(format: IntlFormatter, value: string | null): string {
  if (!value) {
    return "-";
  }

  return format.dateTime(new Date(value), { dateStyle: "medium" });
}

// A task is overdue only while it is still actionable: a past due date on a
// done/cancelled task is just history, not something outstanding.
function isTaskOverdue(task: Task, todayIsoDate: string): boolean {
  if (!task.dueDate) {
    return false;
  }

  if (task.status !== "open" && task.status !== "in_progress") {
    return false;
  }

  return task.dueDate.slice(0, 10) < todayIsoDate;
}

function normalizeTaskStatus(
  value: FormDataEntryValue | string | null | undefined,
): TaskStatus | null {
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

function normalizeDateFilter(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}
