import { AppShell } from "../../../../components/app-shell";
import {
  listAdminUsers,
  listLocations,
  listTasks,
  listVisits,
  type Task,
  type TenantUser,
  type Visit,
} from "../../../../lib/api-client";

type AdminReviewPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type ReviewThreshold = {
  label: string;
  result: string;
  target: string;
  status: "met" | "not-met" | "na";
};

export default async function AdminReviewPage({
  params,
}: AdminReviewPageProps) {
  const { tenantSlug } = await params;
  const [usersResult, visitsResult, tasksResult, locationsResult] =
    await Promise.all([
      listAdminUsers(),
      listVisits("pageSize=100"),
      listTasks("pageSize=100"),
      listLocations(),
    ]);

  if (!usersResult.ok && !visitsResult.ok && !tasksResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
        <header className="page-header">
          <div>
            <p className="eyebrow">Company admin</p>
            <h1>Pilot review</h1>
            <p>
              Live tenant usage data is required before pilot review can be
              generated.
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
            <h2>Pilot review data is not connected</h2>
            <p>{usersResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const users = usersResult.ok ? usersResult.data.items : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const thresholds = buildThresholds({ users, visits, tasks });
  const metCount = thresholds.filter(
    (threshold) => threshold.status === "met",
  ).length;
  const applicableCount = thresholds.filter(
    (threshold) => threshold.status !== "na",
  ).length;
  const readyPercent =
    applicableCount > 0 ? Math.round((metCount / applicableCount) * 100) : 0;
  const summary = buildReviewSummary({
    readyPercent,
    thresholds,
    users,
    visits,
    tasks,
    locations,
  });

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-review">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Pilot review</h1>
          <p>
            Summarize usage after 7-10 days and compare the pilot against the
            agreed success thresholds.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/admin/setup`}>
            Setup
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager`}>
            Manager view
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Pilot review metrics">
        <article className="metric-card">
          <header>
            <p className="metric-label">Thresholds met</p>
            <span
              className={`status-pill ${readyPercent >= 70 ? "active" : "warning"}`}
            >
              Review
            </span>
          </header>
          <p className="metric-value">{readyPercent}%</p>
          <p className="small-label">
            {metCount} of {applicableCount} applicable checks
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Visits</p>
            <span className="status-pill info">Usage</span>
          </header>
          <p className="metric-value">{visits.length}</p>
          <p className="small-label">
            {countCompletedVisits(visits)} confirmed/completed
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">Tasks</p>
            <span className="status-pill info">Follow-up</span>
          </header>
          <p className="metric-value">{tasks.length}</p>
          <p className="small-label">{countDoneTasks(tasks)} closed tasks</p>
        </article>
      </section>

      <section className="review-grid">
        <div className="panel">
          <h2>Success thresholds</h2>
          <div className="review-threshold-list">
            {thresholds.map((threshold) => (
              <article className="review-threshold" key={threshold.label}>
                <div>
                  <span className={`setup-status ${threshold.status}`}>
                    {formatThresholdStatus(threshold.status)}
                  </span>
                  <h3>{threshold.label}</h3>
                  <p>{threshold.target}</p>
                </div>
                <strong>{threshold.result}</strong>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel">
          <h2>Copyable summary</h2>
          <textarea
            className="summary-copy-box"
            readOnly
            rows={18}
            value={summary}
          />
          <p className="form-hint">
            Select and copy this text into the pilot review note or customer
            follow-up.
          </p>
        </aside>
      </section>
    </AppShell>
  );
}

function buildThresholds({
  tasks,
  users,
  visits,
}: {
  tasks: Task[];
  users: TenantUser[];
  visits: Visit[];
}): ReviewThreshold[] {
  const fieldUsers = users.filter((user) =>
    user.roleCodes.includes("field_representative"),
  );
  const activeFieldUserIds = new Set([
    ...visits.map((visit) => visit.representativeUserId),
    ...tasks
      .map((task) => task.assignedToUserId)
      .filter((userId): userId is string => Boolean(userId)),
  ]);
  const activeFieldUsers = fieldUsers.filter((user) =>
    activeFieldUserIds.has(user.id),
  );
  const activeFieldRate =
    fieldUsers.length > 0
      ? Math.round((activeFieldUsers.length / fieldUsers.length) * 100)
      : 0;
  const completedVisits = countCompletedVisits(visits);
  const visitsPerActiveFieldUser =
    activeFieldUsers.length > 0
      ? Math.round(visits.length / activeFieldUsers.length)
      : 0;
  const taskCount = tasks.length;
  const doneTasks = countDoneTasks(tasks);

  return [
    {
      label: "Active field representatives",
      result: `${activeFieldRate}%`,
      target:
        "At least 70% of invited Field Representatives create a visit or complete a task.",
      status:
        fieldUsers.length === 0
          ? "na"
          : activeFieldRate >= 70
            ? "met"
            : "not-met",
    },
    {
      label: "Visit volume",
      result: `${visits.length} visit(s), ${visitsPerActiveFieldUser} per active rep`,
      target:
        "At least 50 visits per pilot tenant or at least 5 visits per active representative for a smaller team.",
      status:
        visits.length >= 50 || visitsPerActiveFieldUser >= 5
          ? "met"
          : "not-met",
    },
    {
      label: "Confirmed reports",
      result: `${completedVisits} completed visit(s)`,
      target:
        "Field visits should produce confirmed/completed reports for manager review.",
      status: completedVisits > 0 ? "met" : "not-met",
    },
    {
      label: "Follow-up actions",
      result: `${taskCount} task(s), ${doneTasks} closed`,
      target:
        "At least 10 tasks or follow-up actions when the pilot scenario includes tasks.",
      status: taskCount >= 10 ? "met" : "not-met",
    },
    {
      label: "AI draft coverage",
      result: "Not measured yet",
      target:
        "At least 60% of visits have an AI draft from voice or text note.",
      status: "na",
    },
    {
      label: "Manager dashboard usage",
      result: "Not measured yet",
      target:
        "Team Manager opens the dashboard at least 3 times during the pilot.",
      status: "na",
    },
    {
      label: "Customer insights",
      result: "Manual discussion",
      target:
        "Customer can name at least 3 management insights from dashboard or AI summaries.",
      status: "na",
    },
  ];
}

function buildReviewSummary({
  locations,
  readyPercent,
  tasks,
  thresholds,
  users,
  visits,
}: {
  locations: Array<{ status: string }>;
  readyPercent: number;
  tasks: Task[];
  thresholds: ReviewThreshold[];
  users: TenantUser[];
  visits: Visit[];
}): string {
  const fieldUsers = users.filter((user) =>
    user.roleCodes.includes("field_representative"),
  );
  const lines = [
    "Vizitum pilot review summary",
    "",
    `Threshold readiness: ${readyPercent}%`,
    `Tenant users: ${users.length} total, ${fieldUsers.length} field representative(s)`,
    `Locations: ${locations.filter((location) => location.status === "active").length} active`,
    `Visits: ${visits.length} total, ${countCompletedVisits(visits)} completed`,
    `Tasks: ${tasks.length} total, ${countDoneTasks(tasks)} closed`,
    "",
    "Thresholds:",
    ...thresholds.map(
      (threshold) =>
        `- ${threshold.label}: ${formatThresholdStatus(threshold.status)} (${threshold.result})`,
    ),
    "",
    "Notes:",
    "- AI draft coverage, manager dashboard usage and customer insights require additional instrumentation or manual review.",
    "- Use this summary as a starting point for the 7-10 day pilot conversation.",
  ];

  return lines.join("\n");
}

function countCompletedVisits(visits: Visit[]): number {
  return visits.filter((visit) => visit.status === "completed").length;
}

function countDoneTasks(tasks: Task[]): number {
  return tasks.filter((task) => task.status === "done").length;
}

function formatThresholdStatus(status: ReviewThreshold["status"]): string {
  switch (status) {
    case "met":
      return "Met";
    case "not-met":
      return "Not met";
    case "na":
      return "N/A";
  }
}
