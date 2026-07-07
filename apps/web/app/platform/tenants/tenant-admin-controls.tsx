"use client";

import { useRef } from "react";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import type { TenantUser } from "../../../lib/api-client";

type TenantAdminControlsProps = {
  admins: TenantUser[];
  inviteAction: (formData: FormData) => Promise<void>;
  isArchived: boolean;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  usersAvailable: boolean;
  updateStatusAction: (formData: FormData) => Promise<void>;
};

export function TenantAdminControls({
  admins,
  inviteAction,
  isArchived,
  tenantId,
  tenantName,
  tenantSlug,
  usersAvailable,
  updateStatusAction,
}: TenantAdminControlsProps) {
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const listDialogRef = useRef<HTMLDialogElement>(null);
  const hasAdmins = usersAvailable && admins.length > 0;

  return (
    <div className="tenant-admin-cell-actions">
      <button
        aria-label={`Invite company admin for ${tenantName}`}
        className="icon-button tenant-metric-action"
        disabled={isArchived}
        onClick={() => inviteDialogRef.current?.showModal()}
        title="Invite company admin"
        type="button"
      >
        +
      </button>
      <button
        aria-label={`View company admins for ${tenantName}`}
        className="secondary-button tenant-metric-list-action"
        disabled={!hasAdmins}
        onClick={() => listDialogRef.current?.showModal()}
        type="button"
      >
        Admins
      </button>

      <dialog
        aria-labelledby={`tenant-admin-invite-title-${tenantId}`}
        className="modal-dialog"
        ref={inviteDialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Company Admin</p>
            <h2 id={`tenant-admin-invite-title-${tenantId}`}>
              Invite company admin
            </h2>
          </div>
          <button
            aria-label="Close invite modal"
            className="icon-button"
            onClick={() => inviteDialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={inviteAction} className="visit-form compact modal-form">
          <input name="tenantId" type="hidden" value={tenantId} />
          <input name="tenantSlug" type="hidden" value={tenantSlug} />
          <label>
            Email
            <input
              name="email"
              placeholder="admin@example.com"
              required
              type="email"
            />
          </label>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => inviteDialogRef.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel="Creating invite..."
            >
              Create invite
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>

      <dialog
        aria-labelledby={`tenant-admin-list-title-${tenantId}`}
        className="modal-dialog"
        ref={listDialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Company Admins</p>
            <h2 id={`tenant-admin-list-title-${tenantId}`}>Company admins</h2>
          </div>
          <button
            aria-label="Close admins modal"
            className="icon-button"
            onClick={() => listDialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="visit-form compact modal-form tenant-admin-modal-body">
          <label>
            Tenant
            <input readOnly type="text" value={tenantName} />
          </label>
          <p className="tenant-status-confirmation">
            Review active Company Admin access for this tenant.
          </p>
          <div className="tenant-admin-list modal-admin-list">
            {admins.map((user) => (
              <div className="tenant-admin-row" key={user.id}>
                <span>{user.email}</span>
                <span className="role-chip">{user.status}</span>
                <form
                  action={updateStatusAction}
                  className="tenant-admin-action"
                >
                  <input name="tenantId" type="hidden" value={tenantId} />
                  <input name="userId" type="hidden" value={user.id} />
                  <input
                    name="status"
                    type="hidden"
                    value={user.status === "suspended" ? "active" : "suspended"}
                  />
                  <PendingSubmitButton
                    className="secondary-button"
                    pendingLabel="Saving..."
                  >
                    {user.status === "suspended" ? "Reactivate" : "Suspend"}
                  </PendingSubmitButton>
                </form>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => listDialogRef.current?.close()}
              type="button"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
