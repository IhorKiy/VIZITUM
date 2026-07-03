import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
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
    error?: string;
    priority?: string;
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
  const selectedStatus = normalizeTaskStatus(pageState.status);
  const selectedPriority = normalizeTaskPriority(pageState.priority);
  const query = new URLSearchParams({ pageSize: "100" });

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (selectedPriority) {
    query.set("priority", selectedPriority);
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
          <h2>Task list</h2>
          <div className="filter-groups">
            <div className="filter-pills" aria-label="Task status filters">
              <a
                aria-current={!selectedStatus ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, null, selectedPriority)}
              >
                All
              </a>
              {taskStatuses.map((status) => (
                <a
                  aria-current={selectedStatus === status ? "page" : undefined}
                  href={buildTaskFilterHref(
                    tenantSlug,
                    status,
                    selectedPriority,
                  )}
                  key={status}
                >
                  {formatLabel(status)}
                </a>
              ))}
            </div>
            <div className="filter-pills" aria-label="Task priority filters">
              <a
                aria-current={!selectedPriority ? "page" : undefined}
                href={buildTaskFilterHref(tenantSlug, selectedStatus, null)}
              >
                Any priority
              </a>
              {taskPriorities.map((priority) => (
                <a
                  aria-current={
                    selectedPriority === priority ? "page" : undefined
                  }
                  href={buildTaskFilterHref(
                    tenantSlug,
                    selectedStatus,
                    priority,
                  )}
                  key={priority}
                >
                  {formatLabel(priority)}
                </a>
              ))}
            </div>
          </div>
        </div>

        {tasks.length > 0 ? (
          <TasksTable
            tasks={tasks}
            updateTaskStatusAction={updateTaskStatusAction}
          />
        ) : (
          <p className="empty-state">
            No tasks match this filter. Switch filters or assign a new task from
            the manager overview.
          </p>
        )}
      </section>
    </AppShell>
  );
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
                <button className="secondary-button" type="submit">
                  Save
                </button>
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
  status: TaskStatus | null,
  priority: TaskPriority | null,
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (priority) {
    query.set("priority", priority);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/manager/tasks${suffix ? `?${suffix}` : ""}`;
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
