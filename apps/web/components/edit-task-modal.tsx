"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import type { Task } from "../lib/api-client";
import { getFormString } from "../lib/form";
import { INPUT_LIMITS } from "../lib/input-limits";
import { PencilIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type EditTaskOption = {
  id: string;
  label: string;
};

// Mirrors CreateOwnTaskActionResult: a successful edit redirects and never
// resolves with a value; a failed one resolves with { ok: false } so the
// still-open dialog can show the error and keep the edited draft.
export type EditTaskActionResult = { ok: false } | void;

type EditTaskDraft = {
  title: string;
  description: string;
  locationId: string;
  isPriority: boolean;
  dueDate: string;
};

type EditableTask = Pick<
  Task,
  "id" | "title" | "description" | "isPriority" | "locationId" | "dueDate"
>;

type EditTaskModalProps = {
  task: EditableTask;
  action: (formData: FormData) => Promise<EditTaskActionResult>;
  // Every tenant location, not just ones the rep is assigned to: the task
  // being edited may already point at a location outside the rep's own
  // assignments (set by a manager), and the select must keep that value
  // choosable instead of silently dropping it on save.
  locationOptions: EditTaskOption[];
};

function draftFromTask(task: EditableTask): EditTaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    locationId: task.locationId ?? "",
    isPriority: task.isPriority,
    dueDate: task.dueDate ?? "",
  };
}

// A per-task edit dialog, one instance per card. Unlike CreateOwnTaskModal /
// AssignTaskModal, open/closed state is not mirrored into the URL — there is
// no single shared query param that could name which of many task cards is
// open. Opening is a plain imperative showModal(); closing after a
// successful save relies on the server action's redirect changing
// searchParams, which this component is otherwise not driving.
export function EditTaskModal({
  task,
  action,
  locationOptions,
}: EditTaskModalProps) {
  const t = useTranslations("field.editTask");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<EditTaskDraft>(() => draftFromTask(task));
  const [submitFailed, setSubmitFailed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  // A successful save redirects, which changes the URL (e.g. to
  // ?task=edited) without remounting this component. Closing here covers
  // that case; a failed save never redirects, so the dialog stays open with
  // the error visible.
  useEffect(() => {
    dialogRef.current?.close();
  }, [searchParams]);

  function openDialog() {
    setDraft(draftFromTask(task));
    setSubmitFailed(false);
    setFormVersion((version) => version + 1);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  // React resets the (uncontrolled) form once the action settles, so a failed
  // save captures the submitted values first and feeds them back as the
  // remounted form's default values (mirrors create-own-task-modal.tsx).
  async function submitAction(formData: FormData) {
    setSubmitFailed(false);

    const values: EditTaskDraft = {
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description"),
      locationId: getFormString(formData, "locationId"),
      isPriority: getFormString(formData, "isPriority") === "true",
      dueDate: getFormString(formData, "dueDate"),
    };
    const result = await action(formData);

    if (result?.ok === false) {
      setDraft(values);
      setSubmitFailed(true);
      setFormVersion((version) => version + 1);
      return;
    }

    // A successful save redirects; close explicitly here rather than leaning
    // only on the searchParams effect, which does not re-fire when two saves
    // in a row land on the same URL (e.g. ?task=edited -> ?task=edited) and
    // would otherwise leave this dialog open showing the just-saved draft.
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-label={t("trigger", { title: task.title })}
        className="name-edit-button"
        onClick={openDialog}
        title={t("trigger", { title: task.title })}
        type="button"
      >
        <PencilIcon />
      </button>

      <dialog
        aria-labelledby={`edit-task-title-${task.id}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={`edit-task-title-${task.id}`}>{t("title")}</h2>
          </div>
          <button
            aria-label={tCommon("cancel")}
            className="icon-button"
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        {submitFailed ? (
          <div className="form-error" role="alert">
            {t("errorBody")}
          </div>
        ) : null}

        <form
          action={submitAction}
          className="visit-form compact modal-form"
          key={formVersion}
        >
          <input name="taskId" type="hidden" value={task.id} />
          <label>
            {t("formTitle")}
            <textarea
              defaultValue={draft.title}
              maxLength={INPUT_LIMITS.title}
              name="title"
              placeholder={t("formTitlePlaceholder")}
              required
              rows={2}
            />
          </label>
          <label>
            {t("formDetails")}
            <textarea
              defaultValue={draft.description}
              maxLength={INPUT_LIMITS.notes}
              name="description"
              placeholder={t("formDetailsPlaceholder")}
              rows={3}
            />
          </label>
          <label>
            {t("formLocation")}
            <select defaultValue={draft.locationId} name="locationId">
              <option value="">{t("formNoLocation")}</option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="checkbox-label">
              <input
                defaultChecked={draft.isPriority}
                name="isPriority"
                type="checkbox"
                value="true"
              />
              {t("formPriority")}
            </label>
            <label>
              {t("formDueDate")}
              <input defaultValue={draft.dueDate} name="dueDate" type="date" />
            </label>
          </div>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={closeDialog}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("saving")}
            >
              {t("save")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
