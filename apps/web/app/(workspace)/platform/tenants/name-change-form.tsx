"use client";

import { useRef, useState } from "react";

import { INPUT_LIMITS } from "../../../../lib/input-limits";
import { FieldIconButton, PencilIcon } from "./field-icon-button";

type NameChangeFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentName: string;
  tenantId: string;
};

export function NameChangeForm({
  action,
  currentName,
  tenantId,
}: NameChangeFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState(currentName);
  const normalizedName = name.trim();
  const canSubmit = normalizedName.length > 0 && normalizedName !== currentName;

  function openDialog() {
    setName(currentName);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-name-form">
      <FieldIconButton
        label={`Edit name for ${currentName}`}
        onClick={openDialog}
      >
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-name-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant name</p>
            <h2 id={`tenant-name-title-${tenantId}`}>Change name</h2>
          </div>
          <button
            aria-label="Close name modal"
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
            Name
            <input
              maxLength={INPUT_LIMITS.name}
              name="name"
              onChange={(event) => setName(event.target.value)}
              required
              type="text"
              value={name}
            />
          </label>
          <p className="tenant-status-confirmation">
            Slug stays unchanged because it is used in workspace URLs and invite
            links.
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
              {isSaving ? "Saving..." : "Confirm name"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
