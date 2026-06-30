import { AppShell } from "../../../components/app-shell";
import { FieldRecordingNotice } from "../../../components/field-recording-notice";

type FieldPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

const visits = [
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

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <header className="page-header">
        <div>
          <p className="eyebrow">Field flow</p>
          <h1>Today&apos;s visits</h1>
          <p>
            Mobile-first workspace for route execution, voice notes and manual
            report confirmation.
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
                  className={`status-pill ${
                    index === 0 ? "active" : index === 1 ? "info" : "warning"
                  }`}
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
                <td>4</td>
              </tr>
              <tr>
                <th scope="row">Remaining</th>
                <td>3</td>
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
