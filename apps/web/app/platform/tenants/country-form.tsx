"use client";

import { useRef, useState } from "react";

import { FieldIconButton, PencilIcon } from "./field-icon-button";

type CountryFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentCountry: string;
  tenantId: string;
};

export function CountryForm({
  action,
  currentCountry,
  tenantId,
}: CountryFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [country, setCountry] = useState(currentCountry);
  const normalizedCountry = country.trim();
  const canSubmit =
    normalizedCountry.length > 0 && normalizedCountry !== currentCountry;

  function openDialog() {
    setCountry(currentCountry);
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
      <FieldIconButton label="Edit country" onClick={openDialog}>
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-country-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant country</p>
            <h2 id={`tenant-country-title-${tenantId}`}>Change country</h2>
          </div>
          <button
            aria-label="Close country modal"
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
            Country
            <input
              name="country"
              onChange={(event) => setCountry(event.target.value)}
              placeholder="UA"
              required
              type="text"
              value={country}
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
              {isSaving ? "Saving..." : "Confirm country"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
