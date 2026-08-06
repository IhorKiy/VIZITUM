"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import type { Task, TaskStatus } from "../lib/api-client";
import { getFormString } from "../lib/form";
import { INPUT_LIMITS } from "../lib/input-limits";
import { MapPinIcon, PencilIcon } from "./icons";
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
  status: TaskStatus;
};

type EditableTask = Pick<
  Task,
  | "id"
  | "title"
  | "description"
  | "isPriority"
  | "locationId"
  | "dueDate"
  | "status"
>;

type EditTaskModalProps = {
  task: EditableTask;
  action: (formData: FormData) => Promise<EditTaskActionResult>;
  // Every tenant location, not just ones the rep is assigned to: the task
  // being edited may already point at a location outside the rep's own
  // assignments (set by a manager), and the select must keep that value
  // choosable instead of silently dropping it on save.
  locationOptions: EditTaskOption[];
  // The list the dialog was opened from, as a query string, submitted with the
  // form so the action's redirect can land back on it. On the form rather than
  // closed over by the action: a Server Action captures what it closes over at
  // build time, and this is per-request.
  listQuery?: string;
  // Today in the tenant timezone, "YYYY-MM-DD" — resolved by the caller. The
  // "Today" chip has to mean the rep's today, not the browser's.
  todayIsoDate: string;
  // Opens the dialog from a labelled button instead of the pencil. The task
  // sheet uses it: there the trigger sits in a row of real actions next to
  // "Complete", where an icon alone would be the only wordless control.
  // A string rather than a node — this is rendered from a server component,
  // and a render prop cannot cross that boundary.
  triggerLabel?: string;
};

function draftFromTask(task: EditableTask): EditTaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    locationId: task.locationId ?? "",
    isPriority: task.isPriority,
    dueDate: task.dueDate?.slice(0, 10) ?? "",
    status: task.status,
  };
}

// The title box is one line that grows with what is typed: a task title is
// usually short, and a permanently three-line box says otherwise.
function fitToContent(field: HTMLTextAreaElement | null) {
  if (!field) {
    return;
  }

  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
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
  listQuery,
  locationOptions,
  todayIsoDate,
  triggerLabel,
}: EditTaskModalProps) {
  const t = useTranslations("field.editTask");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<EditTaskDraft>(() => draftFromTask(task));
  const [submitFailed, setSubmitFailed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  // The three fields the form drives itself, because each one is a control
  // rather than a text box: chips, a switch and a pair of segments.
  const [dueDate, setDueDate] = useState(draft.dueDate);
  const [pickingDate, setPickingDate] = useState(false);
  // True from the moment a save is submitted until the navigation it causes
  // has been seen — see the effect below.
  const submittedRef = useRef(false);

  // A successful save redirects, which changes the URL (e.g. to ?task=edited)
  // without remounting this component. Closing here covers that case; a failed
  // save never redirects, so the dialog stays open with the error visible.
  //
  // Gated on having actually submitted, because this dialog is no longer the
  // only thing writing to the URL: the confirmation notice strips its own
  // params after five seconds, and the sheet around this form is a URL too.
  // Ungated, either of those would shut a form the rep was still typing in.
  useEffect(() => {
    if (!submittedRef.current) {
      return;
    }

    submittedRef.current = false;
    dialogRef.current?.close();
  }, [searchParams]);

  function openDialog() {
    const next = draftFromTask(task);

    setDraft(next);
    setDueDate(next.dueDate);
    setPickingDate(false);
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
    submittedRef.current = true;

    const values: EditTaskDraft = {
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description"),
      locationId: getFormString(formData, "locationId"),
      isPriority: getFormString(formData, "isPriority") === "true",
      dueDate: getFormString(formData, "dueDate"),
      status:
        getFormString(formData, "status") === "done" ? "done" : "in_progress",
    };
    const result = await action(formData);

    if (result?.ok === false) {
      submittedRef.current = false;
      setDraft(values);
      setDueDate(values.dueDate);
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

  // The date the task already carries, always offered as a chip naming that
  // date, so the lit chip is the deadline rather than a word that happens to
  // match it. It used to stand down when the task was due today and let the
  // "Today" chip cover it, which read as a form that had defaulted to today
  // instead of one showing the date the task actually has.
  const keptDate = draft.dueDate;
  const dueChoice = pickingDate
    ? "custom"
    : dueDate === ""
      ? "none"
      : // Ahead of "today" deliberately: when the two are the same date, the
        // one that says which date it is wins.
        dueDate === keptDate
        ? "kept"
        : dueDate === todayIsoDate
          ? "today"
          : "custom";

  function chooseDate(value: string) {
    setDueDate(value);
    setPickingDate(false);
  }

  return (
    <>
      {triggerLabel ? (
        <button className="secondary-button" onClick={openDialog} type="button">
          {triggerLabel}
        </button>
      ) : (
        <button
          aria-label={t("trigger", { title: task.title })}
          className="name-edit-button"
          onClick={openDialog}
          title={t("trigger", { title: task.title })}
          type="button"
        >
          <PencilIcon />
        </button>
      )}

      <dialog
        aria-labelledby={`edit-task-title-${task.id}`}
        className="modal-dialog task-form-dialog"
        ref={dialogRef}
      >
        {/* Takes the dialog's opening focus so the ring does not land on the
            close button — the one control here that must not read as the
            thing to press first. */}
        <div autoFocus className="modal-header" tabIndex={-1}>
          <div>
            <h2 id={`edit-task-title-${task.id}`}>{t("title")}</h2>
          </div>
          {/* The same worded control the sheet under this one closes with,
              not an icon: two levels of the same surface should be dismissed
              the same way. */}
          <button
            className="task-sheet-close"
            onClick={closeDialog}
            type="button"
          >
            {tCommon("close")}
          </button>
        </div>

        {submitFailed ? (
          <div className="form-error" role="alert">
            {t("errorBody")}
          </div>
        ) : null}

        <form action={submitAction} className="task-form" key={formVersion}>
          <input name="taskId" type="hidden" value={task.id} />
          {listQuery === undefined ? null : (
            <input name="listQuery" type="hidden" value={listQuery} />
          )}

          <label className="task-form-field">
            <span className="task-form-label">{t("formTitle")}</span>
            <textarea
              className="task-form-title"
              defaultValue={draft.title}
              maxLength={INPUT_LIMITS.title}
              name="title"
              onInput={(event) => fitToContent(event.currentTarget)}
              placeholder={t("formTitlePlaceholder")}
              ref={fitToContent}
              required
              rows={1}
            />
          </label>

          <label className="task-form-field">
            <span className="task-form-label">
              {t("formDetails")}
              <i>{t("formOptional")}</i>
            </span>
            {/* Two lines to start, growing with what is typed — the same
                treatment the title gets. A box that stands three lines tall
                over two lines of text reads as a field the writer left
                unfinished. */}
            <textarea
              className="task-form-notes"
              defaultValue={draft.description}
              maxLength={INPUT_LIMITS.notes}
              name="description"
              onInput={(event) => fitToContent(event.currentTarget)}
              placeholder={t("formDetailsPlaceholder")}
              ref={fitToContent}
              rows={2}
            />
          </label>

          <label className="task-form-field">
            <span className="task-form-label">{t("formLocation")}</span>
            <span className="task-form-select">
              <MapPinIcon />
              <select defaultValue={draft.locationId} name="locationId">
                <option value="">{t("formNoLocation")}</option>
                {locationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          {/* Chips rather than a bare date box: a due date is nearly always
              "today" or "the day it already says", and both of those are one
              tap here instead of a date picker opened over an empty field. */}
          <div className="task-form-field">
            <span className="task-form-label">{t("formDueDate")}</span>
            <input name="dueDate" type="hidden" value={dueDate} />
            <div className="task-form-chips">
              {keptDate ? (
                <button
                  aria-pressed={dueChoice === "kept"}
                  className="task-form-chip"
                  onClick={() => chooseDate(keptDate)}
                  type="button"
                >
                  {formatChipDate(format, keptDate)}
                </button>
              ) : null}
              {/* Stands down when the kept chip beside it already carries
                  today's date: two chips writing the same value, one lit and
                  one not, is a choice with nothing behind it. */}
              {keptDate === todayIsoDate ? null : (
                <button
                  aria-pressed={dueChoice === "today"}
                  className="task-form-chip"
                  onClick={() => chooseDate(todayIsoDate)}
                  type="button"
                >
                  {t("dueToday")}
                </button>
              )}
              <button
                aria-pressed={dueChoice === "custom"}
                className="task-form-chip"
                onClick={() => setPickingDate(true)}
                type="button"
              >
                {t("dueCustom")}
              </button>
              <button
                aria-pressed={dueChoice === "none"}
                className="task-form-chip"
                onClick={() => chooseDate("")}
                type="button"
              >
                {t("dueNone")}
              </button>
            </div>
            {dueChoice === "custom" ? (
              <input
                aria-label={t("formDueDate")}
                autoFocus
                className="task-form-date"
                onChange={(event) => setDueDate(event.target.value)}
                type="date"
                value={dueDate}
              />
            ) : null}
          </div>

          <label className="task-form-switch">
            <span>
              <b>{t("formPriority")}</b>
            </span>
            <input
              defaultChecked={draft.isPriority}
              name="isPriority"
              role="switch"
              type="checkbox"
              value="true"
            />
            <span aria-hidden="true" className="task-form-track" />
          </label>

          {/* Status belongs in the form as well as on the sheet's own
              "Complete" button: that button is the one-tap answer for a task
              being closed on the spot, this is for a rep already in here
              fixing a date who realises the work is done. */}
          <div className="task-form-field">
            <span className="task-form-label">{t("formStatus")}</span>
            <div className="task-form-segments">
              <label>
                <input
                  defaultChecked={draft.status === "in_progress"}
                  name="status"
                  type="radio"
                  value="in_progress"
                />
                <span>{tCommon("labels.in_progress")}</span>
              </label>
              <label>
                <input
                  defaultChecked={draft.status === "done"}
                  name="status"
                  type="radio"
                  value="done"
                />
                <span>{tCommon("labels.done")}</span>
              </label>
            </div>
          </div>

          <div className="task-form-actions">
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

// "Thursday, 13 Aug" — a due date a rep acts on is a weekday first. Formatted
// in UTC for the reason task-due.ts documents: the value is a date, and the
// tenant's zone would move it a day for anyone west of Greenwich.
function formatChipDate(
  format: ReturnType<typeof useFormatter>,
  isoDate: string,
): string {
  return format.dateTime(new Date(`${isoDate}T00:00:00.000Z`), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "long",
  });
}
