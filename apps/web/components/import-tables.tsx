import { useFormatter, useTranslations } from "next-intl";

import type {
  ImportJobHistoryItem,
  ImportValidationIssue,
} from "../lib/api-client";
import { formatDateTime } from "../lib/format";

type ImportsTranslator = ReturnType<typeof useTranslations<"admin.imports">>;

export function ImportHistoryTable({
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
                  href={`/${tenantSlug}/admin/settings?importJobId=${job.id}&template=${job.templateType}`}
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

export function ImportIssuesTable({
  issues,
}: {
  issues: ImportValidationIssue[];
}) {
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
