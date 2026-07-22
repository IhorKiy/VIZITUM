"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";

import type { LocationPotential } from "../lib/api-client";
import { PencilIcon, PlusIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type LocationPotentialModalProps = {
  action: (formData: FormData) => Promise<void>;
  canManage: boolean;
  locationName: string;
} & (
  | {
      mode: "add";
      availableCategories: { id: string; name: string }[];
      row?: never;
    }
  | { mode: "edit"; row: LocationPotential; availableCategories?: never }
);

// One dialog for both adding a new potential and editing an existing one. The
// two modes differ only in the trigger (a header "+" vs a per-row pencil), the
// category field (a picker when adding, a locked read-only value when editing —
// the category is the upsert key, so changing it would create a second row),
// and the pre-filled values. Both submit the same server `action`.
export function LocationPotentialModal(props: LocationPotentialModalProps) {
  const { action, canManage, locationName, mode } = props;
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const row = props.mode === "edit" ? props.row : null;

  if (!canManage) {
    return null;
  }
  if (props.mode === "add" && props.availableCategories.length === 0) {
    return null;
  }

  // Default the date to today when opening an empty field — deriving it during
  // render would risk a server/client hydration mismatch across a midnight
  // boundary. Offsetting by the timezone keeps the ISO date local.
  function openModal() {
    const input = dateRef.current;
    if (input && !input.value) {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      input.value = local.toISOString().slice(0, 10);
    }
    dialogRef.current?.showModal();
  }

  const title =
    mode === "add" ? t("potentialModal.title") : t("potentialModal.editTitle");

  return (
    <>
      {mode === "add" ? (
        <button
          aria-haspopup="dialog"
          aria-label={title}
          className="location-feature-quick-add"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openModal();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          type="button"
        >
          <PlusIcon size={18} />
        </button>
      ) : (
        <button
          aria-haspopup="dialog"
          aria-label={title}
          className="location-potential-action"
          onClick={openModal}
          type="button"
        >
          <PencilIcon />
        </button>
      )}

      <dialog
        aria-labelledby={titleId}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="modal-subtitle">{locationName}</p>
          </div>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          {props.mode === "add" ? (
            <label>
              <span>
                {t("potentialModal.group")}{" "}
                <span aria-hidden="true" className="field-required">
                  *
                </span>
              </span>
              <select defaultValue="" name="productCategoryId" required>
                <option disabled value="">
                  {t("potentialModal.groupPlaceholder")}
                </option>
                {props.availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="modal-static-field">
              <input
                name="productCategoryId"
                type="hidden"
                value={props.row.productCategoryId}
              />
              <span className="modal-static-label">
                {t("potentialModal.group")}
              </span>
              <span className="modal-static-value">
                {props.row.productCategory.name}
              </span>
            </div>
          )}

          <label>
            <span>
              {t("potentialModal.date")}{" "}
              <span aria-hidden="true" className="field-required">
                *
              </span>
            </span>
            <input
              defaultValue={row?.potentialDate?.slice(0, 10) ?? undefined}
              name="potentialDate"
              ref={dateRef}
              required
              type="date"
            />
          </label>

          <label>
            {t("potentialModal.amount")}
            <input
              defaultValue={row?.potentialAmount ?? undefined}
              min={0}
              name="potentialAmount"
              placeholder={t("potentialModal.amountPlaceholder")}
              type="number"
            />
          </label>

          <div className="modal-month-row">
            <label>
              {t("potentialModal.month1")}
              <input
                defaultValue={row?.planMonth1 ?? undefined}
                min={0}
                name="planMonth1"
                placeholder={t("potentialModal.month1Placeholder")}
                type="number"
              />
            </label>
            <label>
              {t("potentialModal.month2")}
              <input
                defaultValue={row?.planMonth2 ?? undefined}
                min={0}
                name="planMonth2"
                placeholder={t("potentialModal.month2Placeholder")}
                type="number"
              />
            </label>
            <label>
              {t("potentialModal.month3")}
              <input
                defaultValue={row?.planMonth3 ?? undefined}
                min={0}
                name="planMonth3"
                placeholder={t("potentialModal.month3Placeholder")}
                type="number"
              />
            </label>
          </div>

          <label>
            {t("potentialModal.comment")}
            <textarea
              defaultValue={row?.comment ?? undefined}
              name="comment"
              placeholder={t("potentialModal.commentPlaceholder")}
              rows={3}
            />
          </label>

          <PendingSubmitButton
            className="primary-button location-potential-submit"
            pendingLabel={tCommon("saving")}
          >
            {mode === "add" ? t("potentialModal.submit") : tCommon("save")}
          </PendingSubmitButton>
        </form>
      </dialog>
    </>
  );
}
