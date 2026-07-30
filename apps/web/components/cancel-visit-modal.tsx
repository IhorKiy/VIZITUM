"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import {
  deletePendingMedia,
  hasPendingMediaBytes,
  type DraftScope,
} from "../lib/offline-drafts";
import {
  deleteReportOutboxEntryForVisit,
  hasReportOutboxEntryForVisit,
  type ReportOutboxScope,
} from "../lib/report-outbox";
import {
  formatCancellationReason,
  VISIT_CANCELLATION_REASONS,
} from "../lib/visit-cancellation";
import { PendingSubmitButton } from "./pending-submit-button";

type CancelVisitModalProps = {
  action: (formData: FormData) => Promise<void>;
  locationName: string;
  tenantSlug: string;
  userId: string;
  visitId: string;
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
  tenantSlug,
  userId,
  visitId,
}: CancelVisitModalProps) {
  const t = useTranslations("field.visit");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  // The bypass flag means "this submit has already had its unsent work
  // cleaned up" — same shape as field-menu.tsx's sign-out handler, and for the
  // same reason: cleanup has to finish *before* the cancel request goes out,
  // not alongside it, or a slow device can lose the race and send the request
  // while the queued confirm it should have cleared is still there.
  const cleanupDoneRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // What cancelling would throw away, checked fresh every time the dialog
  // opens — null until that check resolves, so the notice never flashes a
  // wrong answer. Purely informational: the cleanup on submit re-checks (by
  // unconditionally deleting) rather than trusting this state, so a stale
  // read here can never leave anything behind.
  const [unsentWork, setUnsentWork] = useState<{
    report: boolean;
    media: boolean;
  } | null>(null);
  // Discards a check from an open() call that isn't the latest — a rep who
  // opens, closes and reopens the dialog before the first read lands must not
  // have it land after and overwrite the second one's answer.
  const checkGenerationRef = useRef(0);
  useEffect(() => setMounted(true), []);

  const draftScope = useMemo<DraftScope>(
    () => ({ tenantSlug, userId, visitId }),
    [tenantSlug, userId, visitId],
  );
  const outboxScope = useMemo<ReportOutboxScope>(
    () => ({ tenantSlug, userId }),
    [tenantSlug, userId],
  );

  // The trigger, not mount: this component is portaled into the DOM once the
  // page loads and stays there for the visit's whole lifetime, but what it
  // has to report on — a photo taken, a report confirmed while offline — only
  // exists from that point forward. A mount-time check would only ever see
  // "nothing pending", since nothing has happened yet.
  function openDialog() {
    const generation = ++checkGenerationRef.current;

    setUnsentWork(null);
    void (async () => {
      const [report, audio, photo] = await Promise.all([
        hasReportOutboxEntryForVisit(outboxScope, visitId),
        hasPendingMediaBytes(draftScope, "audio"),
        hasPendingMediaBytes(draftScope, "photo"),
      ]);

      if (checkGenerationRef.current === generation) {
        setUnsentWork({ report, media: audio || photo });
      }
    })();

    dialogRef.current?.showModal();
  }

  // The form is uncontrolled, so reset() restores the empty defaults for the
  // next open.
  function resetForm() {
    formRef.current?.reset();
  }

  function closeWithReset() {
    resetForm();
    dialogRef.current?.close();
  }

  // Cancelling locks the visit, so nothing queued for it can ever be reopened
  // and resent the way the outbox indicator normally asks for — the recovery
  // path it points to ("open the visit and save it again") stops existing the
  // moment this succeeds. Awaited before the cancel request goes out, exactly
  // like clearDrafts() in field-menu.tsx: firing it and letting the request
  // race the delete would leave the queued confirm to be refused by the
  // server's own VISIT_NOT_ACTIVE guard instead, stranding it in the unsent
  // count with no way back. The draft (what the rep typed but never
  // confirmed) is deliberately left alone — the report form mounted beside
  // this modal owns it and would just write it back on unmount.
  async function discardUnsentWork() {
    setDiscarding(true);

    await Promise.all([
      deletePendingMedia(draftScope, "audio"),
      deletePendingMedia(draftScope, "photo"),
      deleteReportOutboxEntryForVisit(outboxScope, visitId),
    ]);

    setDiscarding(false);
  }

  // See discardUnsentWork above for why this has to finish before the cancel
  // request is sent. The ref means "this submit has already been cleaned up",
  // and the pass-through consumes it rather than latching — same reasoning as
  // field-menu.tsx: a rep whose first tap cannot reach storage in time must
  // still be able to tap again and have it work, and a latched flag would let
  // that second attempt through without cleaning anything up.
  async function handleCancelSubmit(event: FormEvent<HTMLFormElement>) {
    if (cleanupDoneRef.current) {
      cleanupDoneRef.current = false;
      // Defer to a macrotask so React captures the FormData for the server
      // action first, then close explicitly — same trade-off as
      // location-potential-modal.tsx: the redirect surfaces the inline
      // confirmation instead of the button's pending state.
      window.setTimeout(() => {
        dialogRef.current?.close();
        resetForm();
      }, 0);
      return;
    }

    event.preventDefault();
    cleanupDoneRef.current = true;

    await discardUnsentWork();

    formRef.current?.requestSubmit();
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
        onSubmit={handleCancelSubmit}
        ref={formRef}
      >
        {unsentWork && (unsentWork.report || unsentWork.media) ? (
          <div className="form-error" role="alert">
            {unsentWork.report
              ? t("cancelModalUnsentReportNotice")
              : t("cancelModalUnsentMediaNotice")}
          </div>
        ) : null}

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
          disabled={discarding}
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
        onClick={openDialog}
        type="button"
      >
        {t("cancelVisit")}
      </button>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
