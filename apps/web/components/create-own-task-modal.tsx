"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { getFormString } from "../lib/form";
import { INPUT_LIMITS } from "../lib/input-limits";
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
};

export function CreateOwnTaskModal({
  action,
  locationOptions,
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

  function openDialog() {
    setDraft(null);
    setSubmitFailed(false);
    setFormVersion((version) => version + 1);
    dialogRef.current?.showModal();
  }

  // Drops `?create=1` so a page refresh after closing doesn't reopen the
  // dialog. A successful create never reaches this: it redirects to
  // `?task=created` instead. Called directly from the × and Cancel buttons
  // rather than relying solely on the dialog's native `close` event, which
  // doesn't reliably fire for a programmatic `.close()` call in every
  // browser; also wired as onClose below as defense-in-depth for the
  // Escape-key path.
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
        {t("triggerLabel")}
      </button>

      <dialog
        aria-labelledby="create-own-task-title"
        className="modal-dialog"
        onClose={clearCreateParam}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="create-own-task-title">{t("title")}</h2>
          </div>
          <button
            aria-label={tCommon("cancel")}
            className="icon-button"
            onClick={() => closeDialog()}
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
          <label>
            {t("formTitle")}
            <textarea
              defaultValue={draft?.title ?? ""}
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
              defaultValue={draft?.description ?? ""}
              maxLength={INPUT_LIMITS.notes}
              name="description"
              placeholder={t("formDetailsPlaceholder")}
              rows={3}
            />
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
            <label className="checkbox-label">
              <input
                defaultChecked={draft?.isPriority ?? false}
                name="isPriority"
                type="checkbox"
                value="true"
              />
              {t("formPriority")}
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
