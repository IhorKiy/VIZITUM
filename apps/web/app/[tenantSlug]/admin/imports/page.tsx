import { AppShell } from "../../../../components/app-shell";
import {
  buildApiUrl,
  listImportTemplates,
  type ImportTemplateSummary,
} from "../../../../lib/api-client";

type ImportsPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

const demoTemplates: ImportTemplateSummary[] = [
  {
    type: "users",
    label: "Users",
    fileName: "users.csv",
    downloadPath: "/api/imports/templates/users.csv",
    requiredColumns: ["email", "name", "role_code"],
    optionalColumns: ["phone", "external_id"],
  },
  {
    type: "locations",
    label: "Locations",
    fileName: "locations.csv",
    downloadPath: "/api/imports/templates/locations.csv",
    requiredColumns: ["name", "address_line", "city"],
    optionalColumns: ["external_id", "channel"],
  },
  {
    type: "products",
    label: "Products",
    fileName: "products.csv",
    downloadPath: "/api/imports/templates/products.csv",
    requiredColumns: ["sku", "name"],
    optionalColumns: ["brand", "category"],
  },
  {
    type: "initial_visit_task_plan",
    label: "Initial plan",
    fileName: "initial_visit_task_plan.csv",
    downloadPath: "/api/imports/templates/initial_visit_task_plan.csv",
    requiredColumns: ["location_reference", "planned_date"],
    optionalColumns: ["task_title", "task_due_date"],
  },
];

export default async function ImportsPage({ params }: ImportsPageProps) {
  const { tenantSlug } = await params;
  const templatesResult = await listImportTemplates();
  const templates = templatesResult.ok ? templatesResult.data : demoTemplates;

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
          <a
            className="secondary-button"
            href={buildApiUrl("/imports/templates")}
          >
            Download templates
          </a>
          <button className="primary-button" type="button">
            Upload file
          </button>
        </div>
      </header>

      {!templatesResult.ok ? (
        <section className="notice-panel" aria-label="API status">
          <div>
            <p className="eyebrow">Demo mode</p>
            <h2>Import templates are not connected</h2>
            <p>
              Showing sample templates until the Nest API returns an
              authenticated imports response. Reason: {templatesResult.message}
            </p>
          </div>
        </section>
      ) : null}

      <section className="import-grid">
        <div className="panel">
          <h2>Approved templates</h2>
          <div className="field-stack">
            {templates.map((template) => (
              <article className="import-row" key={template.type}>
                <div>
                  <h2>{template.label}</h2>
                  <p>
                    {template.fileName} · {template.requiredColumns.length}{" "}
                    required, {template.optionalColumns.length} optional columns
                  </p>
                </div>
                <a
                  className="icon-button"
                  href={buildApiUrl(template.downloadPath)}
                  title={`Download ${template.label}`}
                >
                  D
                </a>
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
