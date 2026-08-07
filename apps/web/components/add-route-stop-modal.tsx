"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import { MapPinIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type AddRouteStopOption = {
  id: string;
  label: string;
};

type AddRouteStopModalProps = {
  // Always redirects — to ?stop=added or ?stop=failed — so there is no failed
  // state for this dialog to hold open. The redirect remounts the page, which
  // takes the dialog with it.
  action: (formData: FormData) => Promise<void>;
  // The plan the stop joins: today's route, resolved by the caller.
  routePlanId: string;
  // Locations not already on today's route.
  locationOptions: AddRouteStopOption[];
  // What to say instead of the form when there is nothing left to add —
  // "no locations" and "all of them are already on the route" are different
  // answers, and only the caller knows which one applies.
  emptyMessage: string;
};

/**
 * Adding a stop to today's route, as a sheet rather than a disclosure that
 * expands in place. The trigger sits under the route list, where a rep looks
 * after reading it; the form it opens is the same sheet as the task forms
 * (components/create-own-task-modal.tsx), down to the class names.
 *
 * Opened imperatively rather than through the URL, unlike the create-task
 * sheet: the button is right here beside the dialog, so there is no other
 * screen that needs a way to ask for it.
 */
export function AddRouteStopModal({
  action,
  routePlanId,
  locationOptions,
  emptyMessage,
}: AddRouteStopModalProps) {
  const t = useTranslations("field.routes");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="route-add-stop-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <span aria-hidden="true">+</span> {t("addStop")}
      </button>

      <dialog
        aria-labelledby="add-route-stop-title"
        className="modal-dialog task-form-dialog"
        ref={dialogRef}
      >
        {/* Takes the dialog's opening focus so the ring does not land on the
            close button — the one control here that must not read as the
            thing to press first. */}
        <div autoFocus className="modal-header" tabIndex={-1}>
          <div>
            <h2 id="add-route-stop-title">{t("addStop")}</h2>
          </div>
          <button className="sheet-close" onClick={closeDialog} type="button">
            {tCommon("close")}
          </button>
        </div>

        {locationOptions.length > 0 ? (
          <form action={action} className="task-form">
            <input name="routePlanId" type="hidden" value={routePlanId} />

            <label className="task-form-field">
              <span className="task-form-label">{t("locationLabel")}</span>
              <span className="task-form-select">
                <MapPinIcon />
                <select name="locationId" required>
                  {locationOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            <div className="task-form-actions">
              <button
                className="secondary-button"
                onClick={closeDialog}
                type="button"
              >
                {tCommon("cancel")}
              </button>
              <PendingSubmitButton
                className="primary-button"
                pendingLabel={t("adding")}
              >
                {t("addToRoute")}
              </PendingSubmitButton>
            </div>
          </form>
        ) : (
          <p className="empty-state task-form-empty">{emptyMessage}</p>
        )}
      </dialog>
    </>
  );
}
