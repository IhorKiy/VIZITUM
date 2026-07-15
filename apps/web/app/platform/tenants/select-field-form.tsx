"use client";

import { useRef, useState } from "react";

import { FieldIconButton, PencilIcon } from "./field-icon-button";

type SelectFieldFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  tenantId: string;
  currentValue: string;
  // aria-label for the edit trigger — include the tenant name so screen-reader
  // users can tell rows apart in the tenant list.
  triggerLabel: string;
  eyebrow: string;
  title: string;
  fieldLabel: string;
  confirmLabel: string;
  // Name of the form field the server action reads.
  inputName: string;
  options: { value: string; label: string }[];
  // Explanatory copy shown under the select (e.g. what the toggle affects).
  description?: string;
  // Stable prefix for the dialog's aria ids.
  dialogId: string;
};

// Select-backed sibling of SingleFieldForm: one dialog editor for a single
// enum-like value, so per-field forms only supply options and copy instead of
// re-copying the modal shell.
export function SelectFieldForm({
  action,
  tenantId,
  currentValue,
  triggerLabel,
  eyebrow,
  title,
  fieldLabel,
  confirmLabel,
  inputName,
  options,
  description,
  dialogId,
}: SelectFieldFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [value, setValue] = useState(currentValue);
  const canSubmit = value !== currentValue;

  function openDialog() {
    setValue(currentValue);
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
          <label>
            {fieldLabel}
            <select
              name={inputName}
              onChange={(event) => setValue(event.target.value)}
              required
              value={value}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {description ? (
            <p className="tenant-status-confirmation">{description}</p>
          ) : null}
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
