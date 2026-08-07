"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { getFormString } from "../lib/form";
import { INPUT_LIMITS } from "../lib/input-limits";
import { MapPinIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type CreateOwnTaskOption = {
  id: string;
  label: string;
};

// Mirrors AssignTaskActionResult (assign-task-modal.tsx): a successful create
// redirects and never resolves with a value; a failed one resolves with
// { ok: false } so the still-mounted dialog can show the error and keep the
// draft instead of losing it to a page remount.
export type CreateOwnTaskActionResult = { ok: false } | void;

type CreateOwnTaskDraft = {
  title: string;
  description: string;
  locationId: string;
  isPriority: boolean;
  dueDate: string;
};

type CreateOwnTaskModalProps = {
  action: (formData: FormData) => Promise<CreateOwnTaskActionResult>;
  // Only the field rep's own assigned locations — there is no assignee field
  // here, the task is always assigned to whoever opens this form.
  locationOptions: CreateOwnTaskOption[];
  // Today in the tenant timezone, "YYYY-MM-DD" — resolved by the caller, so
  // the "Today" chip means the rep's today rather than the browser's.
  todayIsoDate: string;
};

// The title box is one line that grows with what is typed (twin of the same
// helper in edit-task-modal.tsx).
function fitToContent(field: HTMLTextAreaElement | null) {
  if (!field) {
    return;
  }

  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

/**
 * The create-a-task dialog, opened by `?create=1` and nothing else. It carries
 * no trigger of its own: the button that opens it is the bottom nav's, which
 * every field screen renders and which sets that param (see
 * components/field-create-fab.tsx). One way in means the dialog can be mounted
 * where its data is — this page — while the button lives where a rep can reach
 * it from anywhere.
 *
 * Drawn as the same sheet as edit-task-modal.tsx, down to the class names: the
 * two forms are the same task seen before and after it exists, and a rep who
 * has filled one should recognise the other. The pair are twins — a change to
 * a field here belongs in that file too. This one has no status segments (a
 * task starts in progress) and no chip for a date it already carries.
 */
export function CreateOwnTaskModal({
  action,
  locationOptions,
  todayIsoDate,
}: CreateOwnTaskModalProps) {
  const t = useTranslations("field.createTask");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<CreateOwnTaskDraft | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  // The two controls the form drives itself rather than leaving uncontrolled:
  // the date chips and the picker they reveal.
  const [dueDate, setDueDate] = useState("");
  const [pickingDate, setPickingDate] = useState(false);

  // Declared above the effect that calls it, which is now its only caller:
  // reading it earlier in the body would not pick up later versions of it.
  function openDialog() {
    setDraft(null);
    setDueDate("");
    setPickingDate(false);
    setSubmitFailed(false);
    setFormVersion((version) => version + 1);
    dialogRef.current?.showModal();
  }

  // Keep the dialog in sync with the URL (see assign-task-modal.tsx for why a
  // boolean prop would not do): `?create=1` opens it, anything else closes it.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const shouldOpen = searchParams.get("create") === "1";

    if (shouldOpen && !dialog.open) {
      openDialog();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }, [searchParams]);

  // Drops `?create=1` so a page refresh after closing doesn't reopen the
  // dialog. A successful create never reaches this: it redirects to
  // `?task=created` instead. Called directly from the × and Cancel buttons
  // rather than relying solely on the dialog's native `close` event, which
  // doesn't reliably fire for a programmatic `.close()` call in every
  // browser; also wired as onClose below as defense-in-depth for the
  // Escape-key path.
  //
  // The × this once mentioned is now the sheet's worded "Close".
  function clearCreateParam() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
    clearCreateParam();
  }

  // React resets the (uncontrolled) form once the action settles, so a failed
  // create captures the submitted values first and feeds them back as the
  // remounted form's default values.
  async function submitAction(formData: FormData) {
    setSubmitFailed(false);

    const values: CreateOwnTaskDraft = {
      title: getFormString(formData, "title"),
      description: getFormString(formData, "description"),
      locationId: getFormString(formData, "locationId"),
      isPriority: getFormString(formData, "isPriority") === "true",
      dueDate: getFormString(formData, "dueDate"),
    };
    const result = await action(formData);

    if (result?.ok === false) {
      setDraft(values);
      setDueDate(values.dueDate);
      setSubmitFailed(true);
      setFormVersion((version) => version + 1);
    }
  }

  // No "kept" chip in this twin: a task that does not exist yet carries no
  // date of its own to offer back.
  const dueChoice = pickingDate
    ? "custom"
    : dueDate === ""
      ? "none"
      : dueDate === todayIsoDate
        ? "today"
        : "custom";

  function chooseDate(value: string) {
    setDueDate(value);
    setPickingDate(false);
  }

  return (
    <>
      <dialog
        aria-labelledby="create-own-task-title"
        className="modal-dialog task-form-dialog"
        onClose={clearCreateParam}
        ref={dialogRef}
      >
        {/* Takes the dialog's opening focus so the ring does not land on the
            close button — the one control here that must not read as the
            thing to press first. */}
        <div autoFocus className="modal-header" tabIndex={-1}>
          <div>
            <h2 id="create-own-task-title">{t("title")}</h2>
          </div>
          <button
            className="sheet-close"
            onClick={() => closeDialog()}
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
          <label className="task-form-field">
            <span className="task-form-label">{t("formTitle")}</span>
            <textarea
              className="task-form-title"
              defaultValue={draft?.title ?? ""}
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
            <textarea
              className="task-form-notes"
              defaultValue={draft?.description ?? ""}
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
              <select defaultValue={draft?.locationId ?? ""} name="locationId">
                <option value="">{t("formNoLocation")}</option>
                {locationOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </span>
            {locationOptions.length === 0 ? (
              <span className="form-hint">{t("formLocationHint")}</span>
            ) : null}
          </label>

          {/* Chips rather than a bare date box: a task written down at a
              location is nearly always due today, which is one tap here
              instead of a date picker opened over an empty field. */}
          <div className="task-form-field">
            <span className="task-form-label">{t("formDueDate")}</span>
            <input name="dueDate" type="hidden" value={dueDate} />
            <div className="task-form-chips">
              <button
                aria-pressed={dueChoice === "today"}
                className="task-form-chip"
                onClick={() => chooseDate(todayIsoDate)}
                type="button"
              >
                {t("dueToday")}
              </button>
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
              defaultChecked={draft?.isPriority ?? false}
              name="isPriority"
              role="switch"
              type="checkbox"
              value="true"
            />
            <span aria-hidden="true" className="task-form-track" />
          </label>

          <div className="task-form-actions">
            <button
              className="secondary-button"
              onClick={() => closeDialog()}
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
