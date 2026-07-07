"use client";

import { useRef } from "react";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import type { PlatformSegmentTemplate } from "../../../lib/api-client";
import { defaultTimezoneOption, listTimezones } from "../../../lib/timezones";

type CreateTenantModalProps = {
  action: (formData: FormData) => Promise<void>;
  segmentTemplates: PlatformSegmentTemplate[];
};

export function CreateTenantModal({
  action,
  segmentTemplates,
}: CreateTenantModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timezones = listTimezones();
  const defaultTimezone = defaultTimezoneOption(timezones);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Create tenant
      </button>

      <dialog
        aria-labelledby="create-tenant-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Platform</p>
            <h2 id="create-tenant-title">Create tenant</h2>
          </div>
          <button
            aria-label="Close create tenant modal"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            Name
            <input name="name" type="text" required />
          </label>
          <label>
            Slug
            <input name="slug" type="text" required />
          </label>
          <label>
            Segment template
            <select name="segmentTemplate" required defaultValue="">
              <option value="" disabled>
                Select a template
              </option>
              {segmentTemplates.map((template) => (
                <option key={template} value={template}>
                  {template}
                </option>
              ))}
            </select>
          </label>
          <label>
            Country
            <input name="country" type="text" placeholder="UA" />
          </label>
          <label>
            Timezone
            <select name="timezone" defaultValue={defaultTimezone} required>
              {timezones.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>
          <label>
            Language
            <input name="language" type="text" placeholder="uk" />
          </label>
          <label>
            Primary domain
            <input name="primaryDomain" type="text" />
          </label>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <PendingSubmitButton className="primary-button">
              Create tenant
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
