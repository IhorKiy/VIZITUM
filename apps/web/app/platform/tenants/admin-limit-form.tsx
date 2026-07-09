"use client";

import { useRef, useState } from "react";

type AdminLimitFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  // The owner's explicit override, or null when the tenant follows its plan.
  currentOverride: number | null;
  // The cap implied by the tenant's current plan tier, shown as the default.
  planDefault: number;
  tenantId: string;
};

export function AdminLimitForm({
  action,
  currentOverride,
  planDefault,
  tenantId,
}: AdminLimitFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [followPlan, setFollowPlan] = useState(currentOverride === null);
  const [overrideValue, setOverrideValue] = useState(
    String(currentOverride ?? planDefault),
  );

  const parsedOverride = Number(overrideValue);
  const overrideIsValid =
    Number.isInteger(parsedOverride) && parsedOverride > 0;
  // Nothing to save when the current state already matches what's persisted.
  const isUnchanged = followPlan
    ? currentOverride === null
    : overrideIsValid && parsedOverride === currentOverride;
  const canSubmit = (followPlan || overrideIsValid) && !isUnchanged;

  function openDialog() {
    setFollowPlan(currentOverride === null);
    setOverrideValue(String(currentOverride ?? planDefault));
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <div className="tenant-admin-limit-form">
      <button className="secondary-button" onClick={openDialog} type="button">
        Change admin limit
      </button>
      <dialog
        aria-labelledby={`tenant-admin-limit-title-${tenantId}`}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Company Admin limit</p>
            <h2 id={`tenant-admin-limit-title-${tenantId}`}>
              Change admin limit
            </h2>
          </div>
          <button
            aria-label="Close admin limit modal"
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
          <label className="checkbox-label">
            <input
              checked={followPlan}
              name="followPlan"
              onChange={(event) => setFollowPlan(event.target.checked)}
              type="checkbox"
            />
            Follow the plan tier (allows {planDefault} Company Admin
            {planDefault === 1 ? "" : "s"})
          </label>
          <label>
            Custom Company Admin limit
            <input
              disabled={followPlan}
              min={1}
              name="adminLimit"
              onChange={(event) => setOverrideValue(event.target.value)}
              required={!followPlan}
              type="number"
              value={overrideValue}
            />
          </label>
          <p className="tenant-status-confirmation">
            By default the limit follows the plan tier. Set a custom value only
            as a deliberate per-tenant exception. The tenant superadmin cannot
            invite or reactivate a Company Admin past this limit.
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
              {isSaving ? "Saving..." : "Confirm limit"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
