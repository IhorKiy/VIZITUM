"use client";

import { useRef, useState } from "react";

import { FieldIconButton, PencilIcon } from "./field-icon-button";

type ContactField = "contactName" | "contactEmail" | "contactPhone";

type ContactFieldFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentValue: string | null;
  field: ContactField;
  inputType: "text" | "email" | "tel";
  label: string;
  tenantId: string;
};

// Edits a single primary-contact field (name / email / phone). One generic
// component drives all three so each contact value gets its own edit icon,
// mirroring the Name / Timezone / Language fields.
export function ContactFieldForm({
  action,
  currentValue,
  field,
  inputType,
  label,
  tenantId,
}: ContactFieldFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [value, setValue] = useState(currentValue ?? "");
  const normalizedValue = value.trim();
  const canSubmit =
    normalizedValue.length > 0 && normalizedValue !== (currentValue ?? "");
  const lowerLabel = label.toLowerCase();

  function openDialog() {
    setValue(currentValue ?? "");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-contact-form">
      <FieldIconButton label={`Edit ${lowerLabel}`} onClick={openDialog}>
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-${field}-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Contact details</p>
            <h2 id={`tenant-${field}-title-${tenantId}`}>Edit {lowerLabel}</h2>
          </div>
          <button
            aria-label="Close contact modal"
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
          <input name="field" type="hidden" value={field} />
          <label>
            {label}
            <input
              name="value"
              onChange={(event) => setValue(event.target.value)}
              required
              type={inputType}
              value={value}
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
            <button
              className="primary-button"
              disabled={isSaving || !canSubmit}
              type="submit"
            >
              {isSaving ? "Saving..." : "Confirm"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
