import { AppShell } from "../../../components/app-shell";

type ManagerPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

const metrics = [
  ["Visits today", "42", "7 remaining"],
  ["Reports confirmed", "31", "4 AI drafts waiting"],
  ["Open tasks", "18", "6 high priority"],
] as const;

export default async function ManagerPage({ params }: ManagerPageProps) {
  const { tenantSlug } = await params;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="manager">
      <header className="page-header">
        <div>
          <p className="eyebrow">Team manager</p>
          <h1>Operations dashboard</h1>
          <p>
            Track execution, review report readiness and focus the team on
            blocked work.
          </p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button">
            Export
          </button>
          <button className="primary-button" type="button">
            Assign task
          </button>
        </div>
      </header>

      <section className="manager-grid" aria-label="Manager metrics">
        {metrics.map(([label, value, detail]) => (
          <article className="metric-card" key={label}>
            <header>
              <p className="metric-label">{label}</p>
              <span className="status-pill info">Live</span>
            </header>
            <p className="metric-value">{value}</p>
            <p className="small-label">{detail}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-grid" aria-label="Manager worklists">
        <div className="panel">
          <h2>Representatives</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Route</th>
                <th>Reports</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Olena K.</td>
                <td>Kyiv North</td>
                <td>8 / 10</td>
              </tr>
              <tr>
                <td>Andrii M.</td>
                <td>Kyiv Center</td>
                <td>6 / 7</td>
              </tr>
              <tr>
                <td>Iryna S.</td>
                <td>Kyiv West</td>
                <td>5 / 8</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Attention queue</h2>
          <div className="field-stack">
            <article className="visit-card">
              <header>
                <h2>Late route item</h2>
                <span className="status-pill warning">Route</span>
              </header>
              <p className="visit-meta">Pharmacy 24 has no confirmed report.</p>
            </article>
            <article className="visit-card">
              <header>
                <h2>Import needs fix</h2>
                <span className="status-pill warning">Admin</span>
              </header>
              <p className="visit-meta">users-pilot.csv has 2 invalid rows.</p>
            </article>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
