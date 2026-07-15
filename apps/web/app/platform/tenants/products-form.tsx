"use client";

import { useRef, useState } from "react";

import { FieldIconButton, PencilIcon } from "./field-icon-button";

type ProductsFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  currentEnabled: boolean;
  tenantId: string;
  tenantName: string;
};

export function ProductsForm({
  action,
  currentEnabled,
  tenantId,
  tenantName,
}: ProductsFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [enabled, setEnabled] = useState(currentEnabled);
  const canSubmit = enabled !== currentEnabled;

  function openDialog() {
    setEnabled(currentEnabled);
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
      <FieldIconButton
        label={`Edit product tracking for ${tenantName}`}
        onClick={openDialog}
      >
        <PencilIcon />
      </FieldIconButton>
      <dialog
        aria-labelledby={`tenant-products-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant products</p>
            <h2 id={`tenant-products-title-${tenantId}`}>
              Change product tracking
            </h2>
          </div>
          <button
            aria-label="Close product tracking modal"
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
            Product/SKU tracking
            <select
              name="productsEnabled"
              onChange={(event) => setEnabled(event.target.value === "true")}
              required
              value={enabled ? "true" : "false"}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <p className="tenant-status-confirmation">
            When enabled, this tenant&apos;s admins see the Products area and
            can manage products/SKUs. When disabled, the Products area is
            hidden.
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
              {isSaving ? "Saving..." : "Confirm product tracking"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
