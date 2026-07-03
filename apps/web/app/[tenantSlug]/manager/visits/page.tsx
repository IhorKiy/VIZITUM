import { AppShell } from "../../../../components/app-shell";
import {
  listVisits,
  type ApiResult,
  type PaginatedResponse,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";

type ManagerVisitsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ status?: string }>;
};

const visitStatuses: VisitStatus[] = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
];

export default async function ManagerVisitsPage({
  params,
  searchParams,
}: ManagerVisitsPageProps) {
  const { tenantSlug } = await params;
  const { status } = await searchParams;
  const selectedStatus = normalizeVisitStatus(status);
  const query = new URLSearchParams({ pageSize: "100" });

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  const visitsResult = await listVisits(query.toString());

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
        <header className="page-header">
          <div>
            <p className="eyebrow">Team manager</p>
            <h1>Visits</h1>
            <p>
              Live visit data is required before manager review can continue.
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
            <h2>Visits are not connected</h2>
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.data.items;
  const counters = buildVisitCounters(visitsResult);
  const filterSummary = selectedStatus
    ? `${formatVisitStatus(selectedStatus)} visits`
    : "All visits";

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager-visits">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Visits</h1>
          <p>
            Review tenant visits by status, representative, location and report
            readiness.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/manager`}>
            Overview
          </a>
          <a className="primary-button" href={`/${tenantSlug}/manager/tasks`}>
            Tasks
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Visit metrics">
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
            <h2>Visit list</h2>
            <p>
              Showing {filterSummary.toLowerCase()} across this tenant
              workspace.
            </p>
          </div>
          <div className="filter-pills" aria-label="Visit status filters">
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={`/${tenantSlug}/manager/visits`}
            >
              All
            </a>
            {visitStatuses.map((visitStatus) => (
              <a
                aria-current={
                  selectedStatus === visitStatus ? "page" : undefined
                }
                href={`/${tenantSlug}/manager/visits?status=${visitStatus}`}
                key={visitStatus}
              >
                {formatVisitStatus(visitStatus)}
              </a>
            ))}
          </div>
        </div>

        {visits.length > 0 ? (
          <VisitsTable visits={visits} />
        ) : (
          <div className="empty-state-panel">
            <h2>No visits match this filter</h2>
            <p>
              Use another status filter or start a field visit before reviewing
              visit progress here.
            </p>
            <div className="toolbar">
              {selectedStatus ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/manager/visits`}
                >
                  Show all visits
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                Open field workspace
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function VisitsTable({ visits }: { visits: Visit[] }) {
  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>Location</th>
          <th>Representative</th>
          <th>Status</th>
          <th>Type</th>
          <th>Started</th>
          <th>Completed</th>
        </tr>
      </thead>
      <tbody>
        {visits.map((visit) => (
          <tr key={visit.id}>
            <td>
              <strong>{visit.location.name}</strong>
              <span>
                {visit.location.addressLine}, {visit.location.city}
              </span>
            </td>
            <td>{visit.representative.name}</td>
            <td>
              <span className={`status-pill ${visitStatusTone(visit.status)}`}>
                {formatVisitStatus(visit.status)}
              </span>
            </td>
            <td>{formatLabel(visit.visitType)}</td>
            <td>{formatDateTime(visit.startedAt)}</td>
            <td>{formatDateTime(visit.completedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildVisitCounters(
  visitsResult: ApiResult<PaginatedResponse<Visit>>,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  if (!visitsResult.ok) {
    return [];
  }

  const visits = visitsResult.data.items;
  const completed = visits.filter((visit) => visit.status === "completed");
  const inProgress = visits.filter((visit) => visit.status === "in_progress");
  const waiting = visits.filter(
    (visit) => visit.status === "draft" || visit.status === "in_progress",
  );

  return [
    {
      label: "Visible visits",
      value: String(visitsResult.data.total),
      detail: `${visits.length} loaded on this page`,
      tone: "active",
    },
    {
      label: "Reports confirmed",
      value: String(completed.length),
      detail: `${waiting.length} waiting or in progress`,
      tone: completed.length > 0 ? "active" : "info",
    },
    {
      label: "In progress",
      value: String(inProgress.length),
      detail: "Needs field completion or report confirmation",
      tone: inProgress.length > 0 ? "warning" : "active",
    },
  ];
}

function normalizeVisitStatus(value: string | undefined): VisitStatus | null {
  if (
    value === "draft" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function formatVisitStatus(status: VisitStatus): string {
  return formatLabel(status);
}

function visitStatusTone(status: VisitStatus): "active" | "info" | "warning" {
  if (status === "completed") {
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

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
