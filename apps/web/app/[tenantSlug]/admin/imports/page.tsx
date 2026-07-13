import { redirect } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

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
import { formatDateTime } from "../../../../lib/format";
import { isDemoFallbackEnabled } from "../../../../lib/demo-mode";
import { getFormString } from "../../../../lib/form";

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
  const [t, tAdmin, tCommon] = await Promise.all([
    getTranslations("admin.imports"),
    getTranslations("admin"),
    getTranslations("common"),
  ]);

  async function validateImportAction(formData: FormData) {
    "use server";

    const templateType = getFormString(formData, "templateType").trim();
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

    const importJobId = getFormString(formData, "importJobId").trim();

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
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>

        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notConnectedTitle")}</h2>
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
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
        <div className="toolbar">
          <a
            className="secondary-button"
            href={buildApiUrl("/imports/templates")}
          >
            {t("downloadTemplates")}
          </a>
        </div>
      </header>

      {validationState.applied ? (
        <section className="notice-panel success" aria-label={t("appliedAria")}>
          <div>
            <p className="eyebrow">{t("appliedEyebrow")}</p>
            <h2>{t("appliedTitle")}</h2>
            <p>{t("appliedBody", { count: validationState.applied })}</p>
          </div>
        </section>
      ) : null}

      {validationState.error ? (
        <section className="notice-panel danger" aria-label={t("errorAria")}>
          <div>
            <p className="eyebrow">{t("errorEyebrow")}</p>
            <h2>{t("errorTitle")}</h2>
            <p>{t("errorBody")}</p>
          </div>
          <div className="notice-actions">
            <a className="secondary-button" href="#templates">
              {t("downloadTemplate")}
            </a>
            <a className="primary-button" href="#upload-import">
              {t("uploadCsv")}
            </a>
          </div>
        </section>
      ) : null}

      {!templatesResult.ok && demoFallbackEnabled ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{t("demoBody", { reason: templatesResult.message })}</p>
          </div>
        </section>
      ) : null}

      <section className="import-grid">
        <div className="panel" id="templates">
          <h2>{t("approvedTemplates")}</h2>
          <div className="field-stack">
            {templates.map((template) => (
              <article className="import-row" key={template.type}>
                <div>
                  <h2>{template.label}</h2>
                  <p>
                    {t("templateColumns", {
                      fileName: template.fileName,
                      required: template.requiredColumns.length,
                      optional: template.optionalColumns.length,
                    })}
                  </p>
                </div>
                <a
                  className="icon-button"
                  href={`/${tenantSlug}/admin/imports/templates/${template.type}.csv`}
                  title={t("downloadTemplateTitle", { label: template.label })}
                >
                  D
                </a>
              </article>
            ))}
          </div>
        </div>

        <div className="panel" id="upload-import">
          <h2>{t("uploadValidate")}</h2>
          <form action={validateImportAction} className="visit-form">
            <label>
              {t("template")}
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
              {t("csvFile")}
              <input
                accept=".csv,text/csv"
                name="importFile"
                required
                type="file"
              />
              <span className="form-hint">{t("csvHint")}</span>
            </label>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("validating")}
            >
              {t("validateFile")}
            </PendingSubmitButton>
          </form>
        </div>

        <div className="panel">
          <h2>{t("validationResult")}</h2>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{t("rowStatus")}</th>
                <td>
                  {validationPreview?.status ??
                    validationState.status ??
                    t("noFileValidated")}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("rowRows")}</th>
                <td>
                  {validationPreview?.rowCount ?? validationState.rows ?? "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("rowValid")}</th>
                <td>
                  {validationPreview?.validRowCount ??
                    validationState.valid ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("rowErrors")}</th>
                <td>
                  {validationPreview?.errorRowCount ??
                    validationState.errors ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{t("rowWarnings")}</th>
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
                pendingLabel={t("applying")}
              >
                {t("confirmImport")}
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>

        <div className="panel import-issues-panel">
          <h2>{t("rowIssues")}</h2>
          {importIssues.length > 0 ? (
            <ImportIssuesTable issues={importIssues} />
          ) : (
            <p className="empty-state">
              {validationPreview || validationState.importJobId
                ? t("noRowIssues")
                : t("validateToReview")}
            </p>
          )}
        </div>

        <div className="panel import-history-panel">
          <div className="panel-toolbar">
            <div>
              <h2>{t("importHistory")}</h2>
              <p className="empty-state">{t("importHistoryBody")}</p>
            </div>
          </div>
          {importJobsResult && !importJobsResult.ok ? (
            <p className="empty-state">
              {t("historyUnavailable", { message: importJobsResult.message })}
            </p>
          ) : null}
          {importJobs.length > 0 ? (
            <ImportHistoryTable jobs={importJobs} tenantSlug={tenantSlug} />
          ) : importJobsResult?.ok === false ? null : (
            <p className="empty-state">{t("historyEmpty")}</p>
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
  const t = useTranslations("admin.imports");
  const format = useFormatter();

  return (
    <table className="table import-history-table">
      <thead>
        <tr>
          <th>{t("tableTemplate")}</th>
          <th>{t("tableStatus")}</th>
          <th>{t("tableRows")}</th>
          <th>{t("tableAppliedOutput")}</th>
          <th>{t("tableOwner")}</th>
          <th>{t("tableUpdated")}</th>
          <th>{t("tableReview")}</th>
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
                {formatImportStatus(job.status, t)}
              </span>
            </td>
            <td>
              <strong>{job.rowCount}</strong>
              <span>
                {t("rowCounts", {
                  valid: job.validRowCount,
                  errors: job.errorRowCount,
                  warnings: job.warningRowCount,
                })}
              </span>
            </td>
            <td>{summarizeCreatedCounts(job.createdCounts, t)}</td>
            <td>
              <strong>{job.uploadedBy.name}</strong>
              {job.confirmedBy ? <span>{job.confirmedBy.name}</span> : null}
            </td>
            <td>{formatImportTimestamp(job, format)}</td>
            <td>
              {job.status === "validated" ||
              job.status === "validation_failed" ? (
                <a
                  className="secondary-button"
                  href={`/${tenantSlug}/admin/imports?importJobId=${job.id}&template=${job.templateType}`}
                >
                  {t("review")}
                </a>
              ) : job.status === "applied" ? (
                <span className="empty-state">{t("applied")}</span>
              ) : (
                <span className="empty-state">{t("closed")}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImportIssuesTable({ issues }: { issues: ImportValidationIssue[] }) {
  const t = useTranslations("admin.imports");

  return (
    <table className="table import-issues-table">
      <thead>
        <tr>
          <th>{t("issueRow")}</th>
          <th>{t("issueSeverity")}</th>
          <th>{t("issueField")}</th>
          <th>{t("issueIssue")}</th>
          <th>{t("issueValue")}</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, index) => (
          <tr key={`${issue.rowNumber}-${issue.code}-${index}`}>
            <td>{issue.rowNumber}</td>
            <td>
              <span className={`issue-badge ${issue.severity}`}>
                {issue.severity === "error"
                  ? t("severityError")
                  : t("severityWarning")}
              </span>
            </td>
            <td>{issue.fieldName ?? t("issueRowFallback")}</td>
            <td>
              <strong>{issue.code}</strong>
              <span>{issue.message}</span>
            </td>
            <td>{issue.rawValue || t("emptyValue")}</td>
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

type ImportsTranslator = ReturnType<typeof useTranslations<"admin.imports">>;

function formatImportStatus(
  status: ImportJobHistoryItem["status"],
  t: ImportsTranslator,
): string {
  switch (status) {
    case "uploaded":
      return t("statusUploaded");
    case "validated":
      return t("statusValidated");
    case "validation_failed":
      return t("statusValidationFailed");
    case "confirmed":
      return t("statusConfirmed");
    case "applied":
      return t("statusApplied");
    case "failed":
      return t("statusFailed");
    case "cancelled":
      return t("statusCancelled");
  }
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
  t: ImportsTranslator,
): string {
  if (!counts) {
    return t("notApplied");
  }

  const summary = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${value} ${key}`)
    .join(", ");

  return summary || t("zeroRecords");
}

function formatImportTimestamp(
  job: ImportJobHistoryItem,
  format: ReturnType<typeof useFormatter>,
): string {
  const timestamp =
    job.appliedAt ?? job.confirmedAt ?? job.validatedAt ?? job.createdAt;

  return formatDateTime(format, timestamp);
}
