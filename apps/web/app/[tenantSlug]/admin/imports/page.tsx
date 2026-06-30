import { AppShell } from "../../../../components/app-shell";

type ImportsPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

const templates = [
  ["Users", "Required before role-based pilot access"],
  ["Locations", "Accounts, contacts and assignment base"],
  ["Products", "SKU and assortment reference"],
  ["Initial plan", "First visits and tasks"],
] as const;

export default async function ImportsPage({ params }: ImportsPageProps) {
  const { tenantSlug } = await params;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin">
      <header className="page-header">
        <div>
          <p className="eyebrow">Company admin</p>
          <h1>Onboarding imports</h1>
          <p>
            Review approved templates, validate uploaded files and confirm
            all-or-nothing application.
          </p>
        </div>
        <div className="toolbar">
          <button className="secondary-button" type="button">
            Download templates
          </button>
          <button className="primary-button" type="button">
            Upload file
          </button>
        </div>
      </header>

      <section className="import-grid">
        <div className="panel">
          <h2>Approved templates</h2>
          <div className="field-stack">
            {templates.map(([name, description]) => (
              <article className="import-row" key={name}>
                <div>
                  <h2>{name}</h2>
                  <p>{description}</p>
                </div>
                <button className="icon-button" type="button" title="Download">
                  D
                </button>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Validation queue</h2>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>locations-july.xlsx</td>
                <td>Validated</td>
                <td>128</td>
              </tr>
              <tr>
                <td>users-pilot.csv</td>
                <td>Needs fix</td>
                <td>18</td>
              </tr>
              <tr>
                <td>initial-plan.xlsx</td>
                <td>Ready</td>
                <td>64</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
