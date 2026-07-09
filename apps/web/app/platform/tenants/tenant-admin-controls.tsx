"use client";

import { useRef } from "react";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import type { TenantUser } from "../../../lib/api-client";
import { FieldIconButton, PlusIcon, UsersIcon } from "./field-icon-button";

type TenantAdminControlsProps = {
  activeSuperadmin: TenantUser | null;
  admins: TenantUser[];
  inviteAction: (formData: FormData) => Promise<void>;
  pendingSuperadminInvite: boolean;
  promoteAction: (formData: FormData) => Promise<void>;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  usersAvailable: boolean;
};

export function TenantAdminControls({
  activeSuperadmin,
  admins,
  inviteAction,
  pendingSuperadminInvite,
  promoteAction,
  tenantId,
  tenantName,
  tenantSlug,
  usersAvailable,
}: TenantAdminControlsProps) {
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const manageDialogRef = useRef<HTMLDialogElement>(null);
  const promotableAdmins = admins.filter((admin) => admin.status === "active");
  const inviteButtonLabel = activeSuperadmin
    ? "Replace superadmin"
    : "Invite superadmin";

  return (
    <div className="tenant-admin-cell-actions">
      <FieldIconButton
        label={`${inviteButtonLabel} for ${tenantName}`}
        onClick={() => inviteDialogRef.current?.showModal()}
        title={inviteButtonLabel}
      >
        <PlusIcon />
      </FieldIconButton>
      <FieldIconButton
        disabled={!usersAvailable}
        label={`Manage superadmin and admins for ${tenantName}`}
        onClick={() => manageDialogRef.current?.showModal()}
        title="Manage superadmin and admins"
      >
        <UsersIcon />
      </FieldIconButton>

      <dialog
        aria-labelledby={`tenant-admin-invite-title-${tenantId}`}
        className="modal-dialog"
        ref={inviteDialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tenant Superadmin</p>
            <h2 id={`tenant-admin-invite-title-${tenantId}`}>
              {inviteButtonLabel}
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
              placeholder="superadmin@example.com"
              required
              type="email"
            />
          </label>
          <p className="tenant-status-confirmation">
            {activeSuperadmin
              ? `${activeSuperadmin.email} stays active until this invite is accepted, then becomes a suspended Company Admin.`
              : pendingSuperadminInvite
                ? "This replaces the currently pending superadmin invite."
                : "The superadmin invites and manages this tenant's Company Admins."}
          </p>
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
        ref={manageDialogRef}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Superadmin & Company Admins</p>
            <h2 id={`tenant-admin-list-title-${tenantId}`}>{tenantName}</h2>
          </div>
          <button
            aria-label="Close admins modal"
            className="icon-button"
            onClick={() => manageDialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="visit-form compact modal-form tenant-admin-modal-body">
          <p className="tenant-status-confirmation">
            {activeSuperadmin
              ? `Superadmin: ${activeSuperadmin.email} (${activeSuperadmin.status})`
              : "This tenant has no active superadmin yet."}
          </p>
          <div className="tenant-admin-list modal-admin-list">
            {promotableAdmins.length === 0 ? (
              <p className="empty-state">
                No active Company Admins to promote.
              </p>
            ) : (
              promotableAdmins.map((admin) => (
                <div className="tenant-admin-row" key={admin.id}>
                  <span>{admin.email}</span>
                  <span className="role-chip">{admin.status}</span>
                  <form action={promoteAction} className="tenant-admin-action">
                    <input name="tenantId" type="hidden" value={tenantId} />
                    <input name="userId" type="hidden" value={admin.id} />
                    <PendingSubmitButton
                      className="secondary-button"
                      pendingLabel="Promoting..."
                    >
                      Promote to superadmin
                    </PendingSubmitButton>
                  </form>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => manageDialogRef.current?.close()}
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
