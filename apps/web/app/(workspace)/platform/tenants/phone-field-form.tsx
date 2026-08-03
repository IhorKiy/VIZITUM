"use client";

import { useRef, useState } from "react";

import { PhoneInput } from "../../../../components/phone-input";
import { FieldIconButton, PencilIcon } from "./field-icon-button";

type PhoneFieldFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  tenantId: string;
  currentValue: string | null;
  // Tenant's phone country — the parsing context for national input.
  phoneCountry: string | null;
  triggerLabel: string;
  tenantName: string;
};

// Phone-specific sibling of SingleFieldForm: same dialog-backed inline editor,
// but the input is the shared PhoneInput so the value validates against the
// tenant's phone country and submits as E.164. Unlike SingleFieldForm there is
// no "changed" gate — browser constraint validation on the phone field is the
// submit gate instead.
export function PhoneFieldForm({
  action,
  tenantId,
  currentValue,
  phoneCountry,
  triggerLabel,
  tenantName,
}: PhoneFieldFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-contact-form">
      <FieldIconButton
        label={triggerLabel}
        onClick={() => dialogRef.current?.showModal()}
      >
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-contactPhone-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Contact details</p>
            <h2 id={`tenant-contactPhone-title-${tenantId}`}>
              Edit contact phone
            </h2>
            <p className="modal-subtitle">{tenantName}</p>
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
          <input name="field" type="hidden" value="contactPhone" />
          <label>
            Contact phone
            <PhoneInput
              countryRequiredMessage="Enter the phone in international format starting with +."
              defaultValue={currentValue}
              invalidMessage="Enter a valid phone number."
              name="value"
              phoneCountry={phoneCountry}
              required
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
              disabled={isSaving}
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
