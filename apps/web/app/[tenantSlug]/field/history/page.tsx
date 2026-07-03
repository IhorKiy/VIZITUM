import { AppShell } from "../../../../components/app-shell";
import {
  getCurrentSession,
  listVisits,
  type Visit,
  type VisitStatus,
} from "../../../../lib/api-client";

type FieldHistoryPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    startedFrom?: string;
    startedTo?: string;
    status?: string;
  }>;
};

const visitStatuses: VisitStatus[] = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
];

export default async function FieldHistoryPage({
  params,
  searchParams,
}: FieldHistoryPageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("visits.read_own")
  ) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Visit history</h1>
            <p>
              Field Representative access is required before visit history can
              continue.
            </p>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="Permission status">
          <div>
            <p className="eyebrow">Permission required</p>
            <h2>History is not available</h2>
            <p>Ask a Company Admin to assign the Field Representative role.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const pageState = await searchParams;
  const selectedStatus = normalizeVisitStatus(pageState.status);
  const startedFrom = normalizeDateFilter(pageState.startedFrom);
  const startedTo = normalizeDateFilter(pageState.startedTo);
  const query = new URLSearchParams({ pageSize: "100" });
  const hasFilters = Boolean(selectedStatus || startedFrom || startedTo);

  if (selectedStatus) {
    query.set("status", selectedStatus);
  }

  if (startedFrom) {
    query.set("startedFrom", startedFrom);
  }

  if (startedTo) {
    query.set("startedTo", startedTo);
  }

  const visitsResult = await listVisits(query.toString());

  if (!visitsResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-history">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Visit history</h1>
            <p>
              Live visit data is required before field history can continue.
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
            <h2>Visit history is not connected</h2>
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits = visitsResult.data.items;
  const counters = buildHistoryCounters(visits, visitsResult.data.total);
  const filterSummary = buildHistoryFilterSummary({
    startedFrom,
    startedTo,
    status: selectedStatus,
  });

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-history">
      <header className="page-header">
        <div>
          <p className="eyebrow">Field flow</p>
          <h1>Visit history</h1>
          <p>
            Review your previous visits, confirmed reports and unfinished field
            work across this tenant workspace.
          </p>
        </div>
        <div className="toolbar">
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            Today
          </a>
          <a className="primary-button" href={`/${tenantSlug}/field#new-visit`}>
            New visit
          </a>
        </div>
      </header>

      <section className="manager-grid" aria-label="Visit history metrics">
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
            <h2>My visits</h2>
            <p>Showing {filterSummary.toLowerCase()}.</p>
          </div>
          <div className="filter-pills" aria-label="Visit status filters">
            <a
              aria-current={!selectedStatus ? "page" : undefined}
              href={buildHistoryFilterHref(tenantSlug, null, {
                startedFrom,
                startedTo,
              })}
            >
              All
            </a>
            {visitStatuses.map((status) => (
              <a
                aria-current={selectedStatus === status ? "page" : undefined}
                href={buildHistoryFilterHref(tenantSlug, status, {
                  startedFrom,
                  startedTo,
                })}
                key={status}
              >
                {formatLabel(status)}
              </a>
            ))}
          </div>
        </div>

        <form
          action={`/${tenantSlug}/field/history`}
          className="filter-form field-history-filter-form"
        >
          {selectedStatus ? (
            <input name="status" type="hidden" value={selectedStatus} />
          ) : null}
          <label>
            Started from
            <input
              defaultValue={startedFrom ?? ""}
              name="startedFrom"
              type="date"
            />
          </label>
          <label>
            Started to
            <input
              defaultValue={startedTo ?? ""}
              name="startedTo"
              type="date"
            />
          </label>
          <div className="filter-actions">
            <button className="secondary-button" type="submit">
              Apply filters
            </button>
            {hasFilters ? (
              <a
                className="secondary-button"
                href={`/${tenantSlug}/field/history`}
              >
                Reset
              </a>
            ) : null}
          </div>
        </form>

        {visits.length > 0 ? (
          <HistoryTable visits={visits} />
        ) : (
          <div className="empty-state-panel">
            <h2>No visits match this filter</h2>
            <p>
              Use another status or date filter, or start a new visit from your
              field workspace.
            </p>
            <div className="toolbar">
              {hasFilters ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/field/history`}
                >
                  Show all visits
                </a>
              ) : null}
              <a className="primary-button" href={`/${tenantSlug}/field`}>
                Open today
              </a>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function HistoryTable({ visits }: { visits: Visit[] }) {
  return (
    <table className="table drilldown-table">
      <thead>
        <tr>
          <th>Location</th>
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
            <td>
              <span className={`status-pill ${visitStatusTone(visit.status)}`}>
                {formatLabel(visit.status)}
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

function buildHistoryCounters(
  visits: Visit[],
  total: number,
): Array<{
  label: string;
  value: string;
  detail: string;
  tone: "active" | "info" | "warning";
}> {
  const completed = visits.filter((visit) => visit.status === "completed");
  const unfinished = visits.filter(
    (visit) => visit.status === "draft" || visit.status === "in_progress",
  );

  return [
    {
      label: "Visible visits",
      value: String(total),
      detail: `${visits.length} loaded on this page`,
      tone: "active",
    },
    {
      label: "Completed",
      value: String(completed.length),
      detail: "Visits with confirmed completion",
      tone: completed.length > 0 ? "active" : "info",
    },
    {
      label: "Needs follow-up",
      value: String(unfinished.length),
      detail: "Draft or in-progress visits",
      tone: unfinished.length > 0 ? "warning" : "active",
    },
  ];
}

function buildHistoryFilterHref(
  tenantSlug: string,
  status: VisitStatus | null,
  filters: {
    startedFrom: string | null;
    startedTo: string | null;
  },
): string {
  const query = new URLSearchParams();

  if (status) {
    query.set("status", status);
  }

  if (filters.startedFrom) {
    query.set("startedFrom", filters.startedFrom);
  }

  if (filters.startedTo) {
    query.set("startedTo", filters.startedTo);
  }

  const suffix = query.toString();

  return `/${tenantSlug}/field/history${suffix ? `?${suffix}` : ""}`;
}

function buildHistoryFilterSummary(filters: {
  startedFrom: string | null;
  startedTo: string | null;
  status: VisitStatus | null;
}): string {
  const parts = [
    filters.status ? `${formatLabel(filters.status)} visits` : "All visits",
    filters.startedFrom ? `from ${filters.startedFrom}` : null,
    filters.startedTo ? `to ${filters.startedTo}` : null,
  ].filter(Boolean);

  return parts.join(", ");
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

function normalizeDateFilter(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
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
