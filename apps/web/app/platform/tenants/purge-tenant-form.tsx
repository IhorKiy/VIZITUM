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
 * archive/unarchive it is not a one-click confirm: the platform owner must
 * retype the tenant slug, and the backend re-validates the same slug echo —
 * a mistyped slug changes nothing on either side.
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
  const slugMatches = confirmSlug.trim().toLowerCase() === tenantSlug;

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    setConfirmSlug("");
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
              disabled={!slugMatches}
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
