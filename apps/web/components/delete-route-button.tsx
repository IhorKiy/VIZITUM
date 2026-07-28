"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { TrashIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type DeleteRouteButtonProps = {
  routeId: string;
  routeName: string;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function DeleteRouteButton({
  routeId,
  routeName,
  deleteAction,
}: DeleteRouteButtonProps) {
  const t = useTranslations("field.routes");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function closeDialog() {
    if (isDeleting) {
      return;
    }

    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("deleteRouteAria", { name: routeName })}
        className="name-edit-button is-danger"
        onClick={() => dialogRef.current?.showModal()}
        title={t("deleteRoute")}
        type="button"
      >
        <TrashIcon />
      </button>

      <dialog
        aria-labelledby={`delete-route-title-${routeId}`}
        className="modal-dialog"
        onCancel={(event) => {
          // Blocks Escape while the delete is in flight, matching the
          // disabled Cancel/close buttons below.
          if (isDeleting) {
            event.preventDefault();
          }
        }}
        onClose={() => setIsDeleting(false)}
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id={`delete-route-title-${routeId}`}>{t("deleteRoute")}</h2>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            disabled={isDeleting}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <form
          action={deleteAction}
          className="visit-form compact modal-form"
          onSubmit={() => setIsDeleting(true)}
        >
          <input name="templateId" type="hidden" value={routeId} />
          <p>{t("deleteRoutePrompt")}</p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={isDeleting}
              onClick={closeDialog}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="secondary-button danger"
              pendingLabel={t("deletingRoute")}
            >
              {t("deleteRouteConfirm")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
