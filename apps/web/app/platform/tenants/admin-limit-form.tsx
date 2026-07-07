"use client";

import { useRef, useState } from "react";

type AdminLimitFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentLimit: number;
  tenantId: string;
};

export function AdminLimitForm({
  action,
  currentLimit,
  tenantId,
}: AdminLimitFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [adminLimit, setAdminLimit] = useState(String(currentLimit));
  const parsedLimit = Number(adminLimit);
  const canSubmit =
    Number.isInteger(parsedLimit) &&
    parsedLimit > 0 &&
    parsedLimit !== currentLimit;

  function openDialog() {
    setAdminLimit(String(currentLimit));
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-admin-limit-form">
      <button className="secondary-button" onClick={openDialog} type="button">
        Change admin limit
      </button>
      <dialog
        aria-labelledby={`tenant-admin-limit-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Company Admin limit</p>
            <h2 id={`tenant-admin-limit-title-${tenantId}`}>
              Change admin limit
            </h2>
          </div>
          <button
            aria-label="Close admin limit modal"
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
          <label>
            Active Company Admin limit
            <input
              min={1}
              name="adminLimit"
              onChange={(event) => setAdminLimit(event.target.value)}
              required
              type="number"
              value={adminLimit}
            />
          </label>
          <p className="tenant-status-confirmation">
            The tenant superadmin cannot invite or reactivate a Company Admin
            past this limit.
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
              disabled={isSaving || !canSubmit}
              type="submit"
            >
              {isSaving ? "Saving..." : "Confirm limit"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
