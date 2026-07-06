"use client";

import { useRef } from "react";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import type { PlatformSegmentTemplate } from "../../../lib/api-client";

type CreateTenantModalProps = {
  action: (formData: FormData) => Promise<void>;
  segmentTemplates: PlatformSegmentTemplate[];
};

export function CreateTenantModal({
  action,
  segmentTemplates,
}: CreateTenantModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <section className="panel platform-create-panel" aria-label="Create tenant">
      <div>
        <h2>Create tenant</h2>
        <p>Provision a new workspace.</p>
      </div>
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
            <input name="timezone" type="text" placeholder="Europe/Kiev" />
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
    </section>
  );
}
