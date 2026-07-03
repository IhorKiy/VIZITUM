import { redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { PendingSubmitButton } from "../../../../components/pending-submit-button";
import {
  buildApiUrl,
  confirmImportJob,
  getImportValidationJob,
  listImportJobs,
  listImportTemplates,
  validateCsvImport,
  type ImportJobHistoryItem,
  type ImportTemplateSummary,
  type ImportValidationIssue,
} from "../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../lib/demo-mode";

type ImportsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    applied?: string;
    canConfirm?: string;
    errors?: string;
    importJobId?: string;
    status?: string;
    template?: string;
    rows?: string;
    valid?: string;
    warnings?: string;
    error?: string;
  }>;
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

export default async function ImportsPage({
  params,
  searchParams,
}: ImportsPageProps) {
  const { tenantSlug } = await params;
  const validationState = await searchParams;

  async function validateImportAction(formData: FormData) {
    "use server";

    const templateType = String(formData.get("templateType") ?? "").trim();
    const importFile = formData.get("importFile");

    if (
      !templateType ||
      !(importFile instanceof File) ||
      importFile.size === 0
    ) {
      redirect(`/${tenantSlug}/admin/imports?error=upload`);
    }

    const csvText = await importFile.text();
    const result = await validateCsvImport(templateType, csvText);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/imports?error=validation`);
    }

    const query = new URLSearchParams({
      canConfirm: String(result.data.canConfirm),
      errors: String(result.data.errorRowCount),
      importJobId: result.data.importJobId,
      rows: String(result.data.rowCount),
      status: result.data.status,
      template: result.data.templateType,
      valid: String(result.data.validRowCount),
      warnings: String(result.data.warningRowCount),
    });

    redirect(`/${tenantSlug}/admin/imports?${query.toString()}`);
  }

  async function confirmImportAction(formData: FormData) {
    "use server";

    const importJobId = String(formData.get("importJobId") ?? "").trim();

    if (!importJobId) {
      redirect(`/${tenantSlug}/admin/imports?error=confirm`);
    }

    const result = await confirmImportJob(importJobId);

    if (!result.ok) {
      redirect(`/${tenantSlug}/admin/imports?error=confirm`);
    }

    redirect(
      `/${tenantSlug}/admin/imports?applied=${result.data.appliedRowCount}`,
    );
  }

  const templatesResult = await listImportTemplates();
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!templatesResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-imports">
        <header className="page-header">
          <div>
            <p className="eyebrow">Company admin</p>
            <h1>Onboarding imports</h1>
            <p>
              Live import templates are required in production before import
              setup can continue.
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
            <h2>Import templates are not connected</h2>
            <p>{templatesResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const templates = templatesResult.ok ? templatesResult.data : demoTemplates;
  const importJobsResult = templatesResult.ok ? await listImportJobs() : null;
  const importJobs = importJobsResult?.ok ? importJobsResult.data : [];
  const selectedTemplate =
    templates.find((template) => template.type === validationState.template) ??
    templates[0];
  const validationPreviewResult = validationState.importJobId
    ? await getImportValidationJob(validationState.importJobId)
    : null;
  const validationPreview =
    validationPreviewResult?.ok === true ? validationPreviewResult.data : null;
  const canConfirmImport =
    Boolean(validationPreview?.canConfirm) ||
    (validationState.canConfirm === "true" && validationState.importJobId);
  const importIssues = validationPreview?.issues ?? [];

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-imports">
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
        </div>
      </header>

      {validationState.applied ? (
        <section className="notice-panel success" aria-label="Import status">
          <div>
            <p className="eyebrow">Import applied</p>
            <h2>Rows imported</h2>
            <p>{validationState.applied} rows were applied successfully.</p>
          </div>
        </section>
      ) : null}

      {validationState.error ? (
        <section className="notice-panel danger" aria-label="Import error">
          <div>
            <p className="eyebrow">Import failed</p>
            <h2>Check the file and try again</h2>
            <p>
              Upload a CSV from an approved template and confirm only validated
              imports. If validation fails, fix the row issues and validate the
              same template again before applying data.
            </p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#templates">
              Download template
            </a>
            <a className="primary-button" href="#upload-import">
              Upload CSV
            </a>
          </div>
        </section>
      ) : null}

      {!templatesResult.ok && demoFallbackEnabled ? (
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
        <div className="panel" id="templates">
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
                  href={`/${tenantSlug}/admin/imports/templates/${template.type}.csv`}
                  title={`Download ${template.label}`}
                >
                  D
                </a>
              </article>
            ))}
          </div>
        </div>

        <div className="panel" id="upload-import">
          <h2>Upload and validate</h2>
          <form action={validateImportAction} className="visit-form">
            <label>
              Template
              <select
                defaultValue={selectedTemplate?.type}
                name="templateType"
                required
              >
                {templates.map((template) => (
                  <option key={template.type} value={template.type}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              CSV file
              <input
                accept=".csv,text/csv"
                name="importFile"
                required
                type="file"
              />
              <span className="form-hint">
                Use one of the approved CSV templates. Validation stores a
                reviewable import job before anything is applied.
              </span>
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Validating..."
            >
              Validate file
            </PendingSubmitButton>
          </form>
        </div>

        <div className="panel">
          <h2>Validation result</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Status</th>
                <td>
                  {validationPreview?.status ??
                    validationState.status ??
                    "No file validated"}
                </td>
              </tr>
              <tr>
                <th scope="row">Rows</th>
                <td>
                  {validationPreview?.rowCount ?? validationState.rows ?? "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">Valid</th>
                <td>
                  {validationPreview?.validRowCount ??
                    validationState.valid ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">Errors</th>
                <td>
                  {validationPreview?.errorRowCount ??
                    validationState.errors ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">Warnings</th>
                <td>
                  {validationPreview?.warningRowCount ??
                    validationState.warnings ??
                    "0"}
                </td>
              </tr>
            </tbody>
          </table>
          {canConfirmImport ? (
            <form action={confirmImportAction} className="confirm-inline-form">
              <input
                name="importJobId"
                type="hidden"
                value={
                  validationPreview?.importJobId ?? validationState.importJobId
                }
              />
              <PendingSubmitButton
                className="primary-button"
                pendingLabel="Applying..."
              >
                Confirm import
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>

        <div className="panel import-issues-panel">
          <h2>Row issues</h2>
          {importIssues.length > 0 ? (
            <ImportIssuesTable issues={importIssues} />
          ) : (
            <p className="empty-state">
              {validationPreview || validationState.importJobId
                ? "No row-level issues were found."
                : "Validate a CSV file to review row-level errors and warnings."}
            </p>
          )}
        </div>

        <div className="panel import-history-panel">
          <div className="panel-toolbar">
            <div>
              <h2>Import history</h2>
              <p className="empty-state">
                Latest tenant import jobs, row counts and applied output.
              </p>
            </div>
          </div>
          {importJobsResult && !importJobsResult.ok ? (
            <p className="empty-state">
              Import history is unavailable right now:{" "}
              {importJobsResult.message}
            </p>
          ) : null}
          {importJobs.length > 0 ? (
            <ImportHistoryTable jobs={importJobs} tenantSlug={tenantSlug} />
          ) : importJobsResult?.ok === false ? null : (
            <p className="empty-state">
              Validated and applied imports will appear here after the first
              upload.
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function ImportHistoryTable({
  jobs,
  tenantSlug,
}: {
  jobs: ImportJobHistoryItem[];
  tenantSlug: string;
}) {
  return (
    <table className="table import-history-table">
      <thead>
        <tr>
          <th>Template</th>
          <th>Status</th>
          <th>Rows</th>
          <th>Applied output</th>
          <th>Owner</th>
          <th>Updated</th>
          <th>Review</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>
              <strong>{formatImportTemplate(job.templateType)}</strong>
              <span>{job.id}</span>
            </td>
            <td>
              <span className={`issue-badge ${resolveImportStatusTone(job)}`}>
                {formatImportStatus(job.status)}
              </span>
            </td>
            <td>
              <strong>{job.rowCount}</strong>
              <span>
                {job.validRowCount} valid · {job.errorRowCount} errors ·{" "}
                {job.warningRowCount} warnings
              </span>
            </td>
            <td>{summarizeCreatedCounts(job.createdCounts)}</td>
            <td>
              <strong>{job.uploadedBy.name}</strong>
              {job.confirmedBy ? <span>{job.confirmedBy.name}</span> : null}
            </td>
            <td>{formatImportTimestamp(job)}</td>
            <td>
              {job.status === "validated" ||
              job.status === "validation_failed" ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/imports?importJobId=${job.id}&template=${job.templateType}`}
                >
                  Review
                </a>
              ) : job.status === "applied" ? (
                <span className="empty-state">Applied</span>
              ) : (
                <span className="empty-state">Closed</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImportIssuesTable({ issues }: { issues: ImportValidationIssue[] }) {
  return (
    <table className="table import-issues-table">
      <thead>
        <tr>
          <th>Row</th>
          <th>Severity</th>
          <th>Field</th>
          <th>Issue</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, index) => (
          <tr key={`${issue.rowNumber}-${issue.code}-${index}`}>
            <td>{issue.rowNumber}</td>
            <td>
              <span className={`issue-badge ${issue.severity}`}>
                {issue.severity}
              </span>
            </td>
            <td>{issue.fieldName ?? "Row"}</td>
            <td>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
            </td>
            <td>{issue.rawValue || "Empty"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatImportTemplate(templateType: string): string {
  return templateType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatImportStatus(status: ImportJobHistoryItem["status"]): string {
  return status.replaceAll("_", " ");
}

function resolveImportStatusTone(
  job: ImportJobHistoryItem,
): "error" | "success" | "warning" {
  if (job.status === "applied") {
    return "success";
  }

  return job.status === "validated" ? "warning" : "error";
}

function summarizeCreatedCounts(
  counts: ImportJobHistoryItem["createdCounts"],
): string {
  if (!counts) {
    return "Not applied";
  }

  const summary = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${value} ${key}`)
    .join(", ");

  return summary || "0 records";
}

function formatImportTimestamp(job: ImportJobHistoryItem): string {
  const timestamp =
    job.appliedAt ?? job.confirmedAt ?? job.validatedAt ?? job.createdAt;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
