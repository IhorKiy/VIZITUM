"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import {
  formatCancellationReason,
  VISIT_CANCELLATION_REASONS,
} from "../lib/visit-cancellation";
import { PendingSubmitButton } from "./pending-submit-button";

type CancelVisitModalProps = {
  action: (formData: FormData) => Promise<void>;
  locationName: string;
};

// "Cancel visit" trigger plus the reason dialog, shared by the field visit
// page and the location card. The reason select is required — the backend
// refuses a cancellation without one — and the comment is optional context.
// The <dialog> is portaled to the document body so it always renders in the
// top layer regardless of where the trigger sits (same reasoning as
// location-potential-modal.tsx).
export function CancelVisitModal({
  action,
  locationName,
}: CancelVisitModalProps) {
  const t = useTranslations("field.visit");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The form is uncontrolled, so reset() restores the empty defaults for the
  // next open.
  function resetForm() {
    formRef.current?.reset();
  }

  function closeWithReset() {
    resetForm();
    dialogRef.current?.close();
  }

  const dialog = (
    <dialog
      aria-labelledby={titleId}
      className="modal-dialog"
      onCancel={resetForm}
      ref={dialogRef}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{t("cancelModalTitle")}</h2>
          <p className="modal-subtitle">{locationName}</p>
        </div>
        <button
          aria-label={tCommon("close")}
          className="icon-button"
          onClick={closeWithReset}
          type="button"
        >
          ×
        </button>
      </div>

      <form
        action={action}
        className="visit-form compact modal-form"
        onSubmit={() => {
          // Defer to a macrotask so React captures the FormData for the
          // server action first, then close explicitly — same trade-off as
          // location-potential-modal.tsx: the redirect surfaces the inline
          // confirmation instead of the button's pending state.
          window.setTimeout(() => {
            dialogRef.current?.close();
            resetForm();
          }, 0);
        }}
        ref={formRef}
      >
        <label>
          <span>
            {t("cancelModalReason")}{" "}
            <span aria-hidden="true" className="field-required">
              *
            </span>
          </span>
          <select defaultValue="" name="reason" required>
            <option disabled value="">
              {t("cancelModalReasonPlaceholder")}
            </option>
            {VISIT_CANCELLATION_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {formatCancellationReason(tCommon, reason)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t("cancelModalComment")}
          <textarea
            maxLength={INPUT_LIMITS.comment}
            name="comment"
            placeholder={t("cancelModalCommentPlaceholder")}
            rows={3}
          />
        </label>

        <PendingSubmitButton
          className="secondary-button danger"
          pendingLabel={t("cancelModalPending")}
        >
          {t("cancelModalSubmit")}
        </PendingSubmitButton>
      </form>
    </dialog>
  );

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="secondary-button danger"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("cancelVisit")}
      </button>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
