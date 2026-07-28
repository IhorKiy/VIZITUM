"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { PencilIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type RenameRouteButtonProps = {
  templateId: string;
  templateName: string;
  renameAction: (formData: FormData) => Promise<void>;
};

export function RenameRouteButton({
  templateId,
  templateName,
  renameAction,
}: RenameRouteButtonProps) {
  const t = useTranslations("field.routes");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  function closeDialog() {
    if (isSaving) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("editRouteNameAria")}
        className="name-edit-button"
        onClick={() => dialogRef.current?.showModal()}
        title={t("editRouteNameAria")}
        type="button"
      >
        <PencilIcon />
      </button>

      <dialog
        aria-labelledby={`rename-route-title-${templateId}`}
        className="modal-dialog"
        onCancel={(event) => {
          // Blocks Escape while the save is in flight, matching the
          // disabled Cancel/close buttons below.
          if (isSaving) {
            event.preventDefault();
          }
        }}
        onClose={() => setIsSaving(false)}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id={`rename-route-title-${templateId}`}>
            {t("editRouteNameAria")}
          </h2>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            disabled={isSaving}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <form
          action={renameAction}
          className="visit-form compact modal-form"
          onSubmit={() => setIsSaving(true)}
        >
          <input name="templateId" type="hidden" value={templateId} />
          <label>
            {t("createRouteNameLabel")}
            <input
              autoFocus
              defaultValue={templateName}
              maxLength={INPUT_LIMITS.name}
              name="name"
              required
              type="text"
            />
          </label>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={isSaving}
              onClick={closeDialog}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={tCommon("saving")}
            >
              {tCommon("save")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
