"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type { LocationContact } from "../lib/api-client";
import { PencilIcon, PlusIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type LocationContactFormModalProps = {
  action: (formData: FormData) => Promise<void>;
  canManage: boolean;
  locationName: string;
} & ({ mode: "add"; row?: never } | { mode: "edit"; row: LocationContact });

// One dialog for both adding a new contact and editing an existing one — the
// modes differ only in the trigger (an "add" pill vs a per-row pencil) and
// whether a hidden contactId travels with the form (edit only, tells the
// action to update instead of create). Portaled to the document body so it
// stacks above the contacts manager dialog it is opened from — same technique
// as the location-insights modals.
export function LocationContactFormModal(props: LocationContactFormModalProps) {
  const { action, canManage, locationName, mode } = props;
  const t = useTranslations("field.location");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const row = props.mode === "edit" ? props.row : null;

  if (!canManage) {
    return null;
  }

  function resetForm() {
    formRef.current?.reset();
  }

  function closeWithReset() {
    resetForm();
    dialogRef.current?.close();
  }

  const title =
    mode === "add" ? t("contactsModal.title") : t("contactsModal.editTitle");

  const trigger =
    mode === "add" ? (
      <button
        aria-haspopup="dialog"
        aria-label={title}
        className="location-feature-quick-add"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <PlusIcon size={18} />
      </button>
    ) : (
      <button
        aria-haspopup="dialog"
        aria-label={title}
        className="location-insight-action"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <PencilIcon />
      </button>
    );

  const dialog = (
    <dialog
      aria-labelledby={titleId}
      className="modal-dialog"
      onCancel={resetForm}
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
          onClick={closeWithReset}
          type="button"
        >
          ×
        </button>
      </div>

      <form
        action={action}
        className="visit-form compact modal-form"
        onSubmit={() => {
          // Defer to a macrotask so React captures the FormData for the
          // server action first, then close explicitly — same trade-off as
          // the potential/assortment modals (see their onSubmit comment).
          window.setTimeout(() => {
            dialogRef.current?.close();
            resetForm();
          }, 0);
        }}
        ref={formRef}
      >
        {row ? <input name="contactId" type="hidden" value={row.id} /> : null}

        <label>
          <span>
            {t("contactsModal.name")}{" "}
            <span aria-hidden="true" className="field-required">
              *
            </span>
          </span>
          <input
            defaultValue={row?.name ?? undefined}
            name="name"
            placeholder={t("contactsModal.namePlaceholder")}
            required
            type="text"
          />
        </label>

        <label>
          {t("contactsModal.phone")}
          <input
            defaultValue={row?.phone ?? undefined}
            name="phone"
            type="tel"
          />
        </label>

        <label>
          {t("contactsModal.email")}
          <input
            defaultValue={row?.email ?? undefined}
            name="email"
            type="email"
          />
        </label>

        <label>
          {t("contactsModal.notes")}
          <textarea
            defaultValue={row?.notes ?? undefined}
            name="notes"
            placeholder={t("contactsModal.notesPlaceholder")}
            rows={3}
          />
        </label>

        <PendingSubmitButton
          className="primary-button"
          pendingLabel={tCommon("saving")}
        >
          {mode === "add" ? t("contactsModal.submit") : tCommon("save")}
        </PendingSubmitButton>
      </form>
    </dialog>
  );

  return (
    <>
      {trigger}
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
