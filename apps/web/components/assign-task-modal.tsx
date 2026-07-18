"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { formatEnumLabel } from "../lib/format";
import { getFormString } from "../lib/form";
import { PendingSubmitButton } from "./pending-submit-button";

type AssignTaskOption = {
  id: string;
  label: string;
};

// A successful create ends in a redirect (the action never resolves with a
// value); a failed one must NOT redirect — a redirect remounts the page tree
// and wipes the user's input — so it resolves with { ok: false } and the
// still-mounted dialog shows the error and keeps the draft.
export type AssignTaskActionResult = { ok: false } | void;

type AssignTaskDraft = {
  title: string;
  description: string;
  assignedToUserId: string;
  locationId: string;
  priority: string;
  dueDate: string;
};

type AssignTaskModalProps = {
  action: (formData: FormData) => Promise<AssignTaskActionResult>;
  assigneeOptions: AssignTaskOption[];
  locationOptions: AssignTaskOption[];
};

export function AssignTaskModal({
  action,
  assigneeOptions,
  locationOptions,
}: AssignTaskModalProps) {
  const t = useTranslations("manager.assignTask");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<AssignTaskDraft | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  // Keep the dialog in sync with the URL on every navigation (not a static
  // prop): `?assign=1` opens it, anything else closes it. This closes the
  // modal after a successful create (which redirects to `?task=created`) and
  // reopens it from the success notice's "Assign another" link even when
  // `assign` was already "1" on the previous URL — a boolean prop would not
  // re-fire in that case.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const shouldOpen = searchParams.get("assign") === "1";

    if (shouldOpen && !dialog.open) {
      openDialog();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }, [searchParams]);

  // Opening always starts from a blank form — otherwise "Assign another"
  // would show the previous task's input. Bumping the form key remounts the
  // form, which clears every field and discards any draft left over from an
  // earlier failed submit.
  function openDialog() {
    setDraft(null);
    setSubmitFailed(false);
    setFormVersion((version) => version + 1);
    dialogRef.current?.showModal();
  }

  // React resets the (uncontrolled) form once the action settles, so a failed
  // create captures the submitted values first and feeds them back as the
  // remounted form's default values — a remount is the only way a <select>
  // picks up a new defaultValue.
  async function submitAction(formData: FormData) {
    setSubmitFailed(false);

    const values: AssignTaskDraft = {
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description"),
      assignedToUserId: getFormString(formData, "assignedToUserId"),
      locationId: getFormString(formData, "locationId"),
      priority: getFormString(formData, "priority"),
      dueDate: getFormString(formData, "dueDate"),
    };
    const result = await action(formData);

    if (result?.ok === false) {
      setDraft(values);
      setSubmitFailed(true);
      setFormVersion((version) => version + 1);
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={openDialog}
        type="button"
      >
        {t("title")}
      </button>

      <dialog
        aria-labelledby="assign-task-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="assign-task-title">{t("title")}</h2>
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

        {submitFailed ? (
          <div className="form-error" role="alert">
            {t("taskErrorBody")}
          </div>
        ) : null}

        <form
          action={submitAction}
          className="visit-form compact modal-form"
          key={formVersion}
        >
          <label>
            {t("formTitle")}
            <textarea
              defaultValue={draft?.title ?? ""}
              name="title"
              placeholder={t("formTitlePlaceholder")}
              required
              rows={2}
            />
          </label>
          <label>
            {t("formDetails")}
            <textarea
              defaultValue={draft?.description ?? ""}
              name="description"
              placeholder={t("formDetailsPlaceholder")}
              rows={3}
            />
          </label>
          <label>
            {t("formAssignee")}
            <select
              defaultValue={draft?.assignedToUserId ?? ""}
              name="assignedToUserId"
            >
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
            <select defaultValue={draft?.locationId ?? ""} name="locationId">
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
              <select
                defaultValue={draft?.priority ?? "normal"}
                name="priority"
                required
              >
                <option value="normal">
                  {formatEnumLabel(tCommon, "normal")}
                </option>
                <option value="high">{formatEnumLabel(tCommon, "high")}</option>
                <option value="low">{formatEnumLabel(tCommon, "low")}</option>
              </select>
            </label>
            <label>
              {t("formDueDate")}
              <input
                defaultValue={draft?.dueDate ?? ""}
                name="dueDate"
                type="date"
              />
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
