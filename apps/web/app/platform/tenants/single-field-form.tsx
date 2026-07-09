"use client";

import { useRef, useState } from "react";

import { FieldIconButton, PencilIcon } from "./field-icon-button";

type SingleFieldFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  tenantId: string;
  // Current value shown in the input; null renders as an empty field.
  currentValue: string | null;
  // aria-label for the edit trigger — include the tenant name so screen-reader
  // users can tell rows apart in the tenant list.
  triggerLabel: string;
  eyebrow: string;
  title: string;
  fieldLabel: string;
  confirmLabel: string;
  // Name of the form field the server action reads.
  inputName: string;
  inputType?: "text" | "email" | "tel";
  placeholder?: string;
  // Extra hidden inputs (e.g. which contact field is being edited).
  hiddenFields?: Record<string, string>;
  // Stable prefix for the dialog's aria ids.
  dialogId: string;
};

// One dialog-backed editor for a single required text value, shared by the
// Country and Contact fields (name / email / phone). Each field just supplies
// its labels, input type and target form field; the server action reads them.
export function SingleFieldForm({
  action,
  tenantId,
  currentValue,
  triggerLabel,
  eyebrow,
  title,
  fieldLabel,
  confirmLabel,
  inputName,
  inputType = "text",
  placeholder,
  hiddenFields,
  dialogId,
}: SingleFieldFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [value, setValue] = useState(currentValue ?? "");
  const normalizedValue = value.trim();
  const canSubmit =
    normalizedValue.length > 0 && normalizedValue !== (currentValue ?? "");

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
      <FieldIconButton label={triggerLabel} onClick={openDialog}>
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`${dialogId}-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={`${dialogId}-${tenantId}`}>{title}</h2>
          </div>
          <button
            aria-label="Close modal"
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
          {hiddenFields
            ? Object.entries(hiddenFields).map(([name, val]) => (
                <input key={name} name={name} type="hidden" value={val} />
              ))
            : null}
          <label>
            {fieldLabel}
            <input
              name={inputName}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
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
              {isSaving ? "Saving..." : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
