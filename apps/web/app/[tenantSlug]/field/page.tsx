import { AppShell } from "../../../components/app-shell";
import { FieldRecordingNotice } from "../../../components/field-recording-notice";
import {
  getCurrentSession,
  listVisits,
  type Visit,
} from "../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../lib/demo-mode";

type FieldPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

type FieldVisit = {
  name: string;
  address: string;
  status: string;
  next: string;
};

const demoVisits: FieldVisit[] = [
  {
    name: "Silpo Obolon",
    address: "Heroiv Dnipra Ave, Kyiv",
    status: "In progress",
    next: "Record shelf notes",
  },
  {
    name: "Pharmacy 24",
    address: "Lvivska St, Kyiv",
    status: "Planned",
    next: "Check service agreement",
  },
  {
    name: "Partner Hub",
    address: "Volodymyrska St, Kyiv",
    status: "Follow-up",
    next: "Confirm next order",
  },
];

export default async function FieldPage({ params }: FieldPageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();
  const visitsResult = sessionResult.ok
    ? await listVisits()
    : {
        ok: false as const,
        status: sessionResult.status,
        message: sessionResult.message,
      };
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!visitsResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">Field flow</p>
            <h1>Today&apos;s visits</h1>
            <p>
              Live visit data is required in production before field work can
              continue.
            </p>
          </div>
          <div className="toolbar" aria-label="Session actions">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              Sign in
            </a>
          </div>
        </header>

        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Connection required</p>
            <h2>Backend session is not connected</h2>
            <p>{visitsResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visits =
    visitsResult.ok && visitsResult.data.items.length > 0
      ? visitsResult.data.items.map(toFieldVisit)
      : demoVisits;
  const isDemoMode = !visitsResult.ok && demoFallbackEnabled;
  const representativeName = sessionResult.ok
    ? sessionResult.data.user.name
    : "Demo representative";

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">Field flow</p>
          <h1>Today&apos;s visits</h1>
          <p>
            {representativeName} has a mobile-first workspace for route
            execution, voice notes and manual report confirmation.
          </p>
        </div>
        <div className="toolbar" aria-label="Visit actions">
          <button className="icon-button" type="button" title="Refresh">
            R
          </button>
          <button className="primary-button" type="button">
            New visit
          </button>
        </div>
      </header>

      <FieldRecordingNotice tenantSlug={tenantSlug} />

      {isDemoMode ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Backend session is not connected</h2>
            <p>
              Showing sample visits until the Nest API returns an authenticated
              session. Reason: {visitsResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <section className="dashboard-grid" aria-label="Field workspace">
        <div className="field-stack">
          {visits.map((visit, index) => (
            <article className="visit-card" key={visit.name}>
              <header>
                <div>
                  <h2>{visit.name}</h2>
                  <p className="visit-meta">{visit.address}</p>
                </div>
                <span
                  className={`status-pill ${resolveStatusTone(
                    visit.status,
                    index,
                  )}`}
                >
                  {visit.status}
                </span>
              </header>
              <p className="visit-meta">{visit.next}</p>
              <div className="visit-actions">
                <button className="secondary-button" type="button">
                  Text note
                </button>
                <button className="secondary-button" type="button">
                  Voice note
                </button>
                <button className="primary-button" type="button">
                  Confirm
                </button>
              </div>
            </article>
          ))}
        </div>

        <aside className="panel" aria-labelledby="field-summary-title">
          <h2 id="field-summary-title">Route summary</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Completed</th>
                <td>
                  {
                    visits.filter((visit) => visit.status === "Completed")
                      .length
                  }
                </td>
              </tr>
              <tr>
                <th scope="row">Remaining</th>
                <td>
                  {
                    visits.filter((visit) => visit.status !== "Completed")
                      .length
                  }
                </td>
              </tr>
              <tr>
                <th scope="row">Reports waiting</th>
                <td>2</td>
              </tr>
              <tr>
                <th scope="row">AI drafts</th>
                <td>1</td>
              </tr>
            </tbody>
          </table>
        </aside>
      </section>
    </AppShell>
  );
}

function toFieldVisit(visit: Visit): FieldVisit {
  return {
    name: visit.location.name,
    address: [visit.location.addressLine, visit.location.city]
      .filter(Boolean)
      .join(", "),
    status: formatVisitStatus(visit.status),
    next:
      visit.status === "completed"
        ? "Review confirmed report"
        : visit.status === "cancelled"
          ? "Route item cancelled"
          : "Add note and confirm report",
  };
}

function formatVisitStatus(status: Visit["status"]): string {
  return status
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function resolveStatusTone(status: string, index: number): string {
  if (status === "Completed") {
    return "active";
  }

  if (status === "Cancelled") {
    return "warning";
  }

  return index === 1 ? "info" : "warning";
}
