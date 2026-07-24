"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { CheckIcon, NoteIcon } from "./icons";

type LocationNotesModalProps = {
  action: (formData: FormData) => Promise<void>;
  canManage: boolean;
  locationName: string;
  notes: string | null;
};

// The location note, opened from an icon button in the location header. Any
// rep can open it to read the shared note; a rep assigned to the location
// additionally gets an editable textarea. There is no persistent save button —
// a small confirm check appears only once the text differs from what's stored,
// so viewing stays uncluttered and editing surfaces a lightweight "apply"
// affordance. When the caller cannot manage and there is no note yet, the
// dialog shows an empty state instead of an editable field. Portaled to the
// document body so the dialog is never a DOM descendant of the header.
export function LocationNotesModal({
  action,
  canManage,
  locationName,
  notes,
}: LocationNotesModalProps) {
  const t = useTranslations("field.location");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const initialNote = notes ?? "";
  const [value, setValue] = useState(initialNote);
  const isDirty = value !== initialNote;

  function resetForm() {
    setValue(initialNote);
  }

  function closeWithReset() {
    resetForm();
    dialogRef.current?.close();
  }

  const dialog = (
    <dialog
      aria-labelledby={titleId}
      className="modal-dialog"
      onCancel={resetForm}
      ref={dialogRef}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{t("notesModal.title")}</h2>
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

      {canManage ? (
        <form
          action={action}
          className="visit-form compact modal-form"
          onSubmit={() => {
            // Defer to a macrotask so React captures the FormData for the
            // server action first, then close explicitly — same trade-off as
            // the potential/assortment modals (see their onSubmit comment).
            window.setTimeout(() => {
              dialogRef.current?.close();
            }, 0);
          }}
        >
          <label>
            {t("notesModal.label")}
            <textarea
              maxLength={INPUT_LIMITS.notes}
              name="notes"
              onChange={(event) => setValue(event.target.value)}
              placeholder={t("notesModal.placeholder")}
              rows={6}
              value={value}
            />
          </label>

          {isDirty ? (
            <div className="modal-note-confirm">
              <button
                aria-label={tCommon("save")}
                className="icon-button is-accent"
                type="submit"
              >
                <CheckIcon />
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <div className="modal-body">
          {notes ? (
            <p className="location-note-text">{notes}</p>
          ) : (
            <p className="empty-state">{t("notesEmpty")}</p>
          )}
        </div>
      )}
    </dialog>
  );

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("notesTitle")}
        className="icon-button location-header-icon"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <NoteIcon size={20} />
      </button>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
