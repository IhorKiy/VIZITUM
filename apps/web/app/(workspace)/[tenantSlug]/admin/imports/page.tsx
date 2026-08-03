import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { DismissableNotice } from "../../../../../components/dismissable-notice";
import { DownloadIcon } from "../../../../../components/icons";
import {
  ImportHistoryTable,
  ImportIssuesTable,
} from "../../../../../components/import-tables";
import { ImportUploadModal } from "../../../../../components/import-upload-modal";
import { PendingSubmitButton } from "../../../../../components/pending-submit-button";
import {
  confirmImportJob,
  getImportValidationJob,
  listImportJobs,
  listImportTemplates,
  validateCsvImport,
  type ImportTemplateSummary,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import { formatDateTime, formatLabel } from "../../../../../lib/format";
import { getFormString } from "../../../../../lib/form";

type AdminImportsPageProps = {
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

export default async function AdminImportsPage({
  params,
  searchParams,
}: AdminImportsPageProps) {
  const { tenantSlug } = await params;
  const validationState = await searchParams;
  const [tImports, tAdmin, tCommon, format] = await Promise.all([
    getTranslations("admin.imports"),
    getTranslations("admin"),
    getTranslations("common"),
    getFormatter(),
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
    const result = await validateCsvImport(
      templateType,
      csvText,
      importFile.name,
    );

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

  // All three reads are independent (the validation-preview id comes from the
  // query string), so batch them instead of paying serial round-trips.
  const [templatesResult, importJobsFetch, validationPreviewResult] =
    await Promise.all([
      listImportTemplates(),
      listImportJobs(),
      validationState.importJobId
        ? getImportValidationJob(validationState.importJobId)
        : Promise.resolve(null),
    ]);
  const demoFallbackEnabled = isDemoFallbackEnabled();

  if (!templatesResult.ok && !demoFallbackEnabled) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="admin-imports">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tAdmin("eyebrow")}</p>
            <h1>{tImports("title")}</h1>
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
            <h2>{tImports("notConnectedTitle")}</h2>
            <p>{templatesResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const templates = templatesResult.ok ? templatesResult.data : demoTemplates;
  // Preserve the pre-batching demo-mode behavior: when the templates read
  // failed (API down), the history panel shows its empty state rather than a
  // second "unavailable" error for the jobs read that failed the same way.
  const importJobsResult = templatesResult.ok ? importJobsFetch : null;
  const importJobs = importJobsResult?.ok ? importJobsResult.data : [];
  const selectedTemplate =
    templates.find((template) => template.type === validationState.template) ??
    templates[0];
  const validationPreview =
    validationPreviewResult?.ok === true ? validationPreviewResult.data : null;
  const canConfirmImport =
    Boolean(validationPreview?.canConfirm) ||
    (validationState.canConfirm === "true" && validationState.importJobId);
  const importIssues = validationPreview?.issues ?? [];
  // Surface what was validated (template) and when (timestamp) so the result
  // card is self-explanatory, not just a bag of counts.
  const validatedTemplate =
    validationPreview?.templateType ?? validationState.template ?? null;
  const validatedAt = validationPreview?.validatedAt ?? null;
  // Only auto-expand the validation accordion when the user just ran a
  // validation (query params carry its outcome); otherwise it stays folded.
  const hasValidationActivity = Boolean(
    validationState.importJobId || validationState.status,
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="admin-imports">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tAdmin("eyebrow")}</p>
          <h1>{tImports("title")}</h1>
        </div>
        <div className="toolbar">
          <ImportUploadModal
            action={validateImportAction}
            defaultTemplateType={selectedTemplate?.type}
            templates={templates}
          />
        </div>
      </header>

      {validationState.applied ? (
        <DismissableNotice
          ariaLabel={tImports("appliedAria")}
          body={tImports("appliedBody", { count: validationState.applied })}
          clearParams={["applied"]}
          eyebrow={tImports("appliedEyebrow")}
          title={tImports("appliedTitle")}
          tone="success"
        />
      ) : null}

      {validationState.error ? (
        <DismissableNotice
          actions={
            <a className="secondary-button" href="#templates">
              {tImports("downloadTemplate")}
            </a>
          }
          ariaLabel={tImports("errorAria")}
          body={tImports("errorBody")}
          clearParams={["error"]}
          eyebrow={tImports("errorEyebrow")}
          title={tImports("errorTitle")}
          tone="danger"
        />
      ) : null}

      {!templatesResult.ok && demoFallbackEnabled ? (
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{tImports("notConnectedTitle")}</h2>
            <p>{tImports("demoBody", { reason: templatesResult.message })}</p>
          </div>
        </section>
      ) : null}

      <section className="admin-accordion-stack">
        <details
          className="panel panel-collapsible"
          open={hasValidationActivity}
        >
          <summary className="panel-summary">
            <h2>{tImports("validationResult")}</h2>
          </summary>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{tImports("rowTemplate")}</th>
                <td>
                  {validatedTemplate
                    ? formatLabel(validatedTemplate)
                    : tImports("noFileValidated")}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowFile")}</th>
                <td>{validationPreview?.sourceFileName || "-"}</td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowStatus")}</th>
                <td>
                  {validationPreview?.status ??
                    validationState.status ??
                    tImports("noFileValidated")}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowRows")}</th>
                <td>
                  {validationPreview?.rowCount ?? validationState.rows ?? "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowValid")}</th>
                <td>
                  {validationPreview?.validRowCount ??
                    validationState.valid ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowErrors")}</th>
                <td>
                  {validationPreview?.errorRowCount ??
                    validationState.errors ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowWarnings")}</th>
                <td>
                  {validationPreview?.warningRowCount ??
                    validationState.warnings ??
                    "0"}
                </td>
              </tr>
              <tr>
                <th scope="row">{tImports("rowValidatedAt")}</th>
                <td>{formatDateTime(format, validatedAt)}</td>
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
                pendingLabel={tImports("applying")}
              >
                {tImports("confirmImport")}
              </PendingSubmitButton>
            </form>
          ) : null}

          <div className="setup-subsection">
            <h3>{tImports("rowIssues")}</h3>
            {importIssues.length > 0 ? (
              <ImportIssuesTable issues={importIssues} />
            ) : (
              <p className="empty-state">
                {validationPreview || validationState.importJobId
                  ? tImports("noRowIssues")
                  : tImports("validateToReview")}
              </p>
            )}
          </div>
        </details>

        <details className="panel panel-collapsible" id="templates">
          <summary className="panel-summary">
            <h2>{tImports("approvedTemplates")}</h2>
          </summary>
          <div className="field-stack import-template-grid">
            {templates.map((template) => (
              <article className="import-row" key={template.type}>
                <div>
                  <h2>{template.label}</h2>
                  <p>
                    {tImports("templateColumns", {
                      fileName: template.fileName,
                      required: template.requiredColumns.length,
                      optional: template.optionalColumns.length,
                    })}
                  </p>
                </div>
                <a
                  aria-label={tImports("downloadTemplateTitle", {
                    label: template.label,
                  })}
                  className="icon-button"
                  href={`/${tenantSlug}/admin/imports/templates/${template.type}.csv`}
                  title={tImports("downloadTemplateTitle", {
                    label: template.label,
                  })}
                >
                  <DownloadIcon />
                </a>
              </article>
            ))}
          </div>
        </details>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{tImports("importHistory")}</h2>
          </summary>
          <p className="empty-state">{tImports("importHistoryBody")}</p>
          {importJobsResult && !importJobsResult.ok ? (
            <p className="empty-state">
              {tImports("historyUnavailable", {
                message: importJobsResult.message,
              })}
            </p>
          ) : null}
          {importJobs.length > 0 ? (
            <ImportHistoryTable jobs={importJobs} tenantSlug={tenantSlug} />
          ) : importJobsResult?.ok === false ? null : (
            <p className="empty-state">{tImports("historyEmpty")}</p>
          )}
        </details>
      </section>
    </AppShell>
  );
}
