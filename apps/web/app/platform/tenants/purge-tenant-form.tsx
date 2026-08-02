"use client";

import { useRef, useState } from "react";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { INPUT_LIMITS } from "../../../lib/input-limits";

type PurgeTenantFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
};

/**
 * Purge is the one irreversible action on this screen, so unlike
 * archive/unarchive it is not a one-click confirm. Two different things are
 * asked for, because they prove two different things: retyping the slug proves
 * the *right* tenant was chosen, and a fresh authenticator code proves the
 * person choosing is still the one who signed in — a platform session lasts
 * twelve hours and reaches every tenant's data.
 *
 * The backend re-validates both. A wrong slug or a wrong code changes nothing
 * on either side, and the slug is checked first there so a typo never costs a
 * code.
 */
export function PurgeTenantForm({
  action,
  tenantId,
  tenantName,
  tenantSlug,
}: PurgeTenantFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const slugMatches = confirmSlug.trim().toLowerCase() === tenantSlug;
  // Six digits before the button is live. The backend is the real check; this
  // only keeps an obviously incomplete code from spending an attempt.
  const codeLooksComplete = /^\d{6}$/.test(mfaCode.replace(/[\s-]/g, ""));

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    setConfirmSlug("");
    setMfaCode("");
    dialogRef.current?.close();
  }

  return (
    <div className="tenant-archive-form">
      <button
        className="secondary-button danger"
        onClick={openDialog}
        type="button"
      >
        Purge permanently
      </button>
      <dialog
        aria-labelledby={`tenant-purge-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant lifecycle</p>
            <h2 id={`tenant-purge-title-${tenantId}`}>
              Purge tenant permanently
            </h2>
          </div>
          <button
            aria-label="Close purge modal"
            className="icon-button"
            disabled={isSaving}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <form
          action={action}
          className="visit-form compact modal-form"
          onSubmit={() => setIsSaving(true)}
        >
          <input name="tenantId" type="hidden" value={tenantId} />
          <p className="tenant-status-confirmation">
            This marks {tenantName} for permanent deletion. The background purge
            will irreversibly delete all of its users, visits, reports, imports
            and stored files on its next run. Until the purge starts, Unarchive
            cancels the request.
          </p>
          <label>
            Type the tenant slug <strong>{tenantSlug}</strong> to confirm
            <input
              autoComplete="off"
              maxLength={INPUT_LIMITS.slug}
              name="confirmSlug"
              onChange={(event) => setConfirmSlug(event.target.value)}
              placeholder={tenantSlug}
              type="text"
              value={confirmSlug}
            />
          </label>
          <label>
            Confirm with the current code from your authenticator
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={7}
              name="mfaCode"
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="123456"
              type="text"
              value={mfaCode}
            />
          </label>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={isSaving}
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <PendingSubmitButton
              className="secondary-button danger"
              disabled={!slugMatches || !codeLooksComplete}
              pendingLabel="Marking for purge..."
            >
              Purge this tenant
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}
