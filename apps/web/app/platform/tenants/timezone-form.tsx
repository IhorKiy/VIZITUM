"use client";

import { useRef, useState } from "react";

import { timezoneOptionsWith } from "../../../lib/timezones";
import { FieldIconButton, PencilIcon } from "./field-icon-button";

type TimezoneFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentTimezone: string;
  tenantId: string;
};

export function TimezoneForm({
  action,
  currentTimezone,
  tenantId,
}: TimezoneFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [timezone, setTimezone] = useState(currentTimezone);
  const timezones = timezoneOptionsWith(currentTimezone);
  const canSubmit = Boolean(timezone) && timezone !== currentTimezone;

  function openDialog() {
    setTimezone(currentTimezone);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-timezone-form">
      <FieldIconButton label="Edit timezone" onClick={openDialog}>
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-timezone-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant timezone</p>
            <h2 id={`tenant-timezone-title-${tenantId}`}>Change timezone</h2>
          </div>
          <button
            aria-label="Close timezone modal"
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
            IANA time zone
            <select
              name="timezone"
              onChange={(event) => setTimezone(event.target.value)}
              required
              value={timezone}
            >
              {timezones.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <p className="tenant-status-confirmation">
            Dates and times for this tenant are shown in this time zone.
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
              {isSaving ? "Saving..." : "Confirm timezone"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
