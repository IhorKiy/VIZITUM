"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import { formatEnumLabel } from "../lib/format";
import { TENANT_ROLES } from "../lib/tenant-roles";
import { PendingSubmitButton } from "./pending-submit-button";

type InviteUserModalProps = {
  action: (formData: FormData) => Promise<void>;
  canInviteAdmins: boolean;
};

export function InviteUserModal({
  action,
  canInviteAdmins,
}: InviteUserModalProps) {
  const t = useTranslations("admin.users");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("inviteUser")}
      </button>

      <dialog
        aria-labelledby="invite-user-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="invite-user-title">{t("inviteUser")}</h2>
            <p className="small-label">
              {t("inviteUserBody")}
              {canInviteAdmins ? "" : t("inviteUserAdminsHint")}
            </p>
          </div>
          <button
            aria-label={t("cancelEdit")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            {t("email")}
            <input
              name="email"
              placeholder={t("emailPlaceholder")}
              required
              type="email"
            />
          </label>
          <fieldset className="checkbox-group">
            <legend>{t("roles")}</legend>
            {TENANT_ROLES.map((roleCode) => (
              <label key={roleCode}>
                <input
                  disabled={roleCode === "company_admin" && !canInviteAdmins}
                  name={roleCode}
                  type="checkbox"
                />
                <span>{formatEnumLabel(tCommon, roleCode)}</span>
              </label>
            ))}
          </fieldset>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              {t("cancelEdit")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("creating")}
            >
              {t("createInvite")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
