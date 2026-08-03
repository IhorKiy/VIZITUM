"use client";

import { useRef, useState } from "react";

import { PendingSubmitButton } from "../../../../components/pending-submit-button";

type ArchiveTenantFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  mode: "archive" | "unarchive";
  tenantId: string;
  tenantName: string;
};

export function ArchiveTenantForm({
  action,
  mode,
  tenantId,
  tenantName,
}: ArchiveTenantFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isArchive = mode === "archive";
  const label = isArchive ? "Archive" : "Unarchive";
  const pendingLabel = isArchive ? "Archiving..." : "Unarchiving...";
  const confirmationText = isArchive
    ? `Archive ${tenantName}? This will move the tenant out of active management.`
    : `Restore ${tenantName} from the archive? It comes back as suspended, so you'll need to change its status again to let it serve requests.`;

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-archive-form">
      <button
        className={`secondary-button${isArchive ? " danger" : ""}`}
        onClick={openDialog}
        type="button"
      >
        {label}
      </button>
      <dialog
        aria-labelledby={`tenant-archive-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant lifecycle</p>
            <h2 id={`tenant-archive-title-${tenantId}`}>{label} tenant</h2>
          </div>
          <button
            aria-label={`Close ${mode} modal`}
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
          <p className="tenant-status-confirmation">{confirmationText}</p>
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
              className="secondary-button"
              pendingLabel={pendingLabel}
            >
              Confirm {label.toLowerCase()}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}
