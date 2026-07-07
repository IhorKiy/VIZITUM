"use client";

import { useRef, useState } from "react";

type StatusChangeFormProps = {
  archiveAction: (formData: FormData) => void | Promise<void>;
  currentStatus: string;
  statuses: string[];
  tenantId: string;
  tenantName: string;
  updateAction: (formData: FormData) => void | Promise<void>;
};

export function StatusChangeForm({
  archiveAction,
  currentStatus,
  statuses,
  tenantId,
  tenantName,
  updateAction,
}: StatusChangeFormProps) {
  const archiveFormRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const statusInputRef = useRef<HTMLInputElement>(null);
  const updateFormRef = useRef<HTMLFormElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);

  const selectedStatusLabel =
    selectedStatus === "archived" ? "Archive" : selectedStatus;

  function openDialog() {
    setSelectedStatus(currentStatus);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  function confirmStatusChange() {
    if (selectedStatus === currentStatus) {
      dialogRef.current?.close();
      return;
    }

    if (selectedStatus === "archived") {
      setIsSaving(true);
      archiveFormRef.current?.requestSubmit();
      return;
    }

    setIsSaving(true);
    if (statusInputRef.current) {
      statusInputRef.current.value = selectedStatus;
    }
    updateFormRef.current?.requestSubmit();
  }

  return (
    <div className="tenant-status-form">
      <form action={updateAction} ref={updateFormRef}>
        <input name="tenantId" type="hidden" value={tenantId} />
        <input
          defaultValue={currentStatus}
          name="status"
          ref={statusInputRef}
          type="hidden"
        />
      </form>
      <form action={archiveAction} ref={archiveFormRef}>
        <input name="tenantId" type="hidden" value={tenantId} />
      </form>
      <button
        className="secondary-button"
        disabled={isSaving}
        onClick={openDialog}
        type="button"
      >
        {isSaving ? "Saving..." : "Change status"}
      </button>
      <dialog
        aria-labelledby={`tenant-status-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant status</p>
            <h2 id={`tenant-status-title-${tenantId}`}>Change status</h2>
          </div>
          <button
            aria-label="Close status modal"
            className="icon-button"
            disabled={isSaving}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="visit-form compact modal-form">
          <label>
            Status
            <select
              aria-label={`Status for ${tenantName}`}
              disabled={isSaving}
              onChange={(event) => setSelectedStatus(event.target.value)}
              value={selectedStatus}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === "archived" ? "Archive" : status}
                </option>
              ))}
            </select>
          </label>
          <p className="tenant-status-confirmation">
            {selectedStatus === "archived"
              ? `Archive ${tenantName}? This will move the tenant out of active management.`
              : selectedStatus === currentStatus
                ? `Current status is ${currentStatus}.`
                : `Change ${tenantName} status from ${currentStatus} to ${selectedStatus}?`}
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={isSaving}
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              className={
                selectedStatus === "archived"
                  ? "secondary-button"
                  : "primary-button"
              }
              disabled={isSaving || selectedStatus === currentStatus}
              onClick={confirmStatusChange}
              type="button"
            >
              {isSaving ? "Saving..." : `Confirm ${selectedStatusLabel}`}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
