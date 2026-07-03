import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../../../lib/api-client";

type ManagerTasksPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    assignedToUserId?: string;
    dueFrom?: string;
    dueTo?: string;
    error?: string;
    priority?: string;
    status?: string;
    updated?: string;
  }>;
};

const taskStatuses: TaskStatus[] = ["open", "in_progress", "done", "cancelled"];
const taskPriorities: TaskPriority[] = ["high", "normal", "low"];

type FilterOption = {
  id: string;
  label: string;
};

export default async function ManagerTasksPage({
  params,
  searchParams,
}: ManagerTasksPageProps) {
  const { tenantSlug } = await params;
  const pageState = await searchParams;
  const selectedStatus = normalizeTaskStatus(pageState.status);
  const selectedPriority = normalizeTaskPriority(pageState.priority);
  const selectedAssigneeId = normalizeFilterValue(pageState.assignedToUserId);
  const dueFrom = normalizeDateFilter(pageState.dueFrom);
  const dueTo = normalizeDateFilter(pageState.dueTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(
    selectedStatus ||
    selectedPriority ||
    selectedAssigneeId ||
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

  if (dueFrom) {
    query.set("dueFrom", dueFrom);
  }

  if (dueTo) {
    query.set("dueTo", dueTo);
  }

  async function updateTaskStatusAction(formData: FormData) {
    "use server";

    const taskId = String(formData.get("taskId") ?? "").trim();
    const status = normalizeTaskStatus(String(formData.get("status") ?? ""));

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

  if (!tasksResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-tasks">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Tasks</h1>
            <p>
              Live task data is required before manager follow-up review can
              continue.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Tasks are not connected</h2>
            <p>{tasksResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const tasks = tasksResult.data.items;
  const counters = buildTaskCounters(tasks, tasksResult.data.total);
  const assigneeOptions = allTasksResult.ok
    ? buildAssigneeOptions(allTasksResult.data.items)
    : [];
  const selectedAssigneeLabel =
    assigneeOptions.find((option) => option.id === selectedAssigneeId)?.label ??
    null;
  const filterSummary = buildTaskFilterSummary({
    assigneeLabel: selectedAssigneeLabel,
    dueFrom,
    dueTo,
    priority: selectedPriority,
    status: selectedStatus,
  });

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-tasks">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Tasks</h1>
          <p>
            Review team follow-ups, update task state and focus on overdue or
            high-priority work.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            Overview
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/visits`}>
            Visits
          </a>
        </div>
      </header>

      {pageState.updated ? (
        <section className="notice-panel success" aria-label="Task update">
          <div>
            <p className="eyebrow">Task updated</p>
            <h2>Status saved</h2>
            <p>The task list now reflects the latest status.</p>
          </div>
        </section>
      ) : null}

      {pageState.error ? (
        <section className="notice-panel danger" aria-label="Task error">
          <div>
            <p className="eyebrow">Update failed</p>
            <h2>Task status was not saved</h2>
            <p>Refresh the task list and try again.</p>
          </div>
        </section>
      ) : null}

      <section className="manager-grid" aria-label="Task metrics">
        {counters.map((counter) => (
          <article className="metric-card" key={counter.label}>
            <header>
              <p className="metric-label">{counter.label}</p>
              <span className={`status-pill ${counter.tone}`}>
                {counter.tone === "active" ? "OK" : counter.tone}
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
            <h2>Task list</h2>
            <p>Showing {filterSummary.toLowerCase()} for this tenant.</p>
          </div>
          <div className="filter-groups">
            <div className="filter-pills" aria-label="Task status filters">
              <a
                aria-current={!selectedStatus ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, {
                  assignedToUserId: selectedAssigneeId,
                  dueFrom,
                  dueTo,
                  priority: selectedPriority,
                  status: null,
                })}
              >
                All
              </a>
              {taskStatuses.map((status) => (
                <a
                  aria-current={selectedStatus === status ? "page" : undefined}
                  href={buildTaskFilterHref(tenantSlug, {
                    assignedToUserId: selectedAssigneeId,
                    dueFrom,
                    dueTo,
                    priority: selectedPriority,
                    status,
                  })}
                  key={status}
                >
                  {formatLabel(status)}
                </a>
              ))}
            </div>
            <div className="filter-pills" aria-label="Task priority filters">
              <a
                aria-current={!selectedPriority ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, {
                  assignedToUserId: selectedAssigneeId,
                  dueFrom,
                  dueTo,
                  priority: null,
                  status: selectedStatus,
                })}
              >
                Any priority
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
                    priority,
                    status: selectedStatus,
                  })}
                  key={priority}
                >
                  {formatLabel(priority)}
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
            Assignee
            <select
              defaultValue={selectedAssigneeId ?? ""}
              name="assignedToUserId"
            >
              <option value="">Any assignee</option>
              {assigneeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due from
            <input defaultValue={dueFrom ?? ""} name="dueFrom" type="date" />
          </label>
          <label>
            Due to
            <input defaultValue={dueTo ?? ""} name="dueTo" type="date" />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              Apply filters
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/manager/tasks`}
              >
                Reset
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
            <h2>No tasks match this filter</h2>
            <p>
              Use another status or priority filter, or create a follow-up from
              the manager overview.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/tasks`}
                >
                  Show all tasks
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/manager`}>
                Assign task
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function buildAssigneeOptions(tasks: Task[]): FilterOption[] {
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

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function TasksTable({
  tasks,
  updateTaskStatusAction,
}: {
  tasks: Task[];
  updateTaskStatusAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>Task</th>
          <th>Assignee</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Due</th>
          <th>Update</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id}>
            <td>
              <strong>{task.title}</strong>
              <span>{task.description ?? "No additional details"}</span>
            </td>
            <td>{task.assignedTo?.name ?? "Unassigned"}</td>
            <td>
              <span className={`status-pill ${taskStatusTone(task.status)}`}>
                {formatLabel(task.status)}
              </span>
            </td>
            <td>{formatLabel(task.priority)}</td>
            <td>{formatDate(task.dueDate)}</td>
            <td>
              <form
                action={updateTaskStatusAction}
                className="inline-control-form"
              >
                <input name="taskId" type="hidden" value={task.id} />
                <select
                  aria-label={`Update ${task.title} status`}
                  defaultValue={task.status}
                  name="status"
                >
                  {taskStatuses.map((status) => (
                    <option key={status} value={status}>
                      {formatLabel(status)}
                    </option>
                  ))}
                </select>
                <PendingSubmitButton
                  className="secondary-button"
                  pendingLabel="Saving..."
                >
                  Save
                </PendingSubmitButton>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildTaskCounters(
  tasks: Task[],
  total: number,
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
      label: "Visible tasks",
      value: String(total),
      detail: `${tasks.length} loaded on this page`,
      tone: "active",
    },
    {
      label: "Open work",
      value: String(open.length),
      detail: `${highPriority.length} high-priority open task(s)`,
      tone: highPriority.length > 0 ? "warning" : "active",
    },
    {
      label: "Overdue",
      value: String(overdue.length),
      detail: "Open tasks past due date",
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
    priority: TaskPriority | null;
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

  if (filters.dueFrom) {
    query.set("dueFrom", filters.dueFrom);
  }

  if (filters.dueTo) {
    query.set("dueTo", filters.dueTo);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/tasks${suffix ? `?${suffix}` : ""}`;
}

function buildTaskFilterSummary(filters: {
  assigneeLabel: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  priority: TaskPriority | null;
  status: TaskStatus | null;
}): string {
  const parts = [
    filters.status ? `${formatLabel(filters.status)} tasks` : "All tasks",
    filters.priority ? `${formatLabel(filters.priority)} priority` : null,
    filters.assigneeLabel ? `assigned to ${filters.assigneeLabel}` : null,
    filters.dueFrom ? `from ${filters.dueFrom}` : null,
    filters.dueTo ? `to ${filters.dueTo}` : null,
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

function formatLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return today;
}
