"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import type { ImportTemplateSummary } from "../lib/api-client";
import { PendingSubmitButton } from "./pending-submit-button";

type ImportUploadModalProps = {
  action: (formData: FormData) => Promise<void>;
  templates: ImportTemplateSummary[];
  defaultTemplateType?: string;
};

export function ImportUploadModal({
  action,
  templates,
  defaultTemplateType,
}: ImportUploadModalProps) {
  const t = useTranslations("admin.imports");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("newImport")}
      </button>

      <dialog
        aria-labelledby="import-upload-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="import-upload-title">{t("uploadValidate")}</h2>
          </div>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            {t("template")}
            <select
              defaultValue={defaultTemplateType}
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

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("validating")}
            >
              {t("validateFile")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
