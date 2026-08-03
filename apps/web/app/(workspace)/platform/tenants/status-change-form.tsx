"use client";

import { useRef, useState } from "react";

import { formatLabel } from "../../../../lib/format";
import { FieldIconButton, PencilIcon } from "./field-icon-button";

type StatusChangeFormProps = {
  currentStatus: string;
  statuses: string[];
  tenantId: string;
  tenantName: string;
  updateAction: (formData: FormData) => void | Promise<void>;
};

export function StatusChangeForm({
  currentStatus,
  statuses,
  tenantId,
  tenantName,
  updateAction,
}: StatusChangeFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const statusInputRef = useRef<HTMLInputElement>(null);
  const updateFormRef = useRef<HTMLFormElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);
  // A tenant can in principle sit on a status that's no longer assignable
  // (e.g. a retired one from before a migration). Fall back to including it
  // so the select always has a matching, visible option instead of
  // rendering blank.
  const selectableStatuses = statuses.includes(currentStatus)
    ? statuses
    : [currentStatus, ...statuses];

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
      <FieldIconButton
        disabled={isSaving}
        label={`Edit status for ${tenantName}`}
        onClick={openDialog}
      >
        <PencilIcon />
      </FieldIconButton>
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
              {selectableStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <p className="tenant-status-confirmation">
            {selectedStatus === currentStatus
              ? `Current status is ${formatLabel(currentStatus)}.`
              : `Change ${tenantName} status from ${formatLabel(currentStatus)} to ${formatLabel(selectedStatus)}?`}
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
              className="primary-button"
              disabled={isSaving || selectedStatus === currentStatus}
              onClick={confirmStatusChange}
              type="button"
            >
              {isSaving
                ? "Saving..."
                : `Confirm ${formatLabel(selectedStatus)}`}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
