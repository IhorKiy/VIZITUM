"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { formatEnumLabel } from "../lib/format";
import { PendingSubmitButton } from "./pending-submit-button";

type AssignTaskOption = {
  id: string;
  label: string;
};

type AssignTaskModalProps = {
  action: (formData: FormData) => Promise<void>;
  assigneeOptions: AssignTaskOption[];
  locationOptions: AssignTaskOption[];
  defaultOpen?: boolean;
};

export function AssignTaskModal({
  action,
  assigneeOptions,
  locationOptions,
  defaultOpen = false,
}: AssignTaskModalProps) {
  const t = useTranslations("manager.overview");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (defaultOpen && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, [defaultOpen]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("assignTask")}
      </button>

      <dialog
        aria-labelledby="assign-task-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="assign-task-title">{t("assignTask")}</h2>
          </div>
          <button
            aria-label={tCommon("cancel")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            {t("formTitle")}
            <textarea
              name="title"
              placeholder={t("formTitlePlaceholder")}
              required
              rows={2}
            />
          </label>
          <label>
            {t("formDetails")}
            <textarea
              name="description"
              placeholder={t("formDetailsPlaceholder")}
              rows={3}
            />
          </label>
          <label>
            {t("formAssignee")}
            <select name="assignedToUserId">
              <option value="">{t("formUnassigned")}</option>
              {assigneeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {assigneeOptions.length === 0 ? (
              <span className="form-hint">{t("formAssigneeHint")}</span>
            ) : null}
          </label>
          <label>
            {t("formLocation")}
            <select name="locationId">
              <option value="">{t("formNoLocation")}</option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {locationOptions.length === 0 ? (
              <span className="form-hint">{t("formLocationHint")}</span>
            ) : null}
          </label>
          <div className="form-row">
            <label>
              {t("formPriority")}
              <select name="priority" defaultValue="normal" required>
                <option value="normal">
                  {formatEnumLabel(tCommon, "normal")}
                </option>
                <option value="high">{formatEnumLabel(tCommon, "high")}</option>
                <option value="low">{formatEnumLabel(tCommon, "low")}</option>
              </select>
            </label>
            <label>
              {t("formDueDate")}
              <input name="dueDate" type="date" />
            </label>
          </div>

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
              pendingLabel={t("creating")}
            >
              {t("createTask")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
