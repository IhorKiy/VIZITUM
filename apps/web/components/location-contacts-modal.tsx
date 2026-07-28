"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type { LocationContact } from "../lib/api-client";
import type { LocationKeeper } from "../lib/location-keeper";
import { UserIcon } from "./icons";
import { LocationContactFormModal } from "./location-contact-form-modal";
import { LocationContactsPanel } from "./location-contacts-panel";

// A location holds at most two contacts (mirrors the admin zone's fixed
// two-slot contact form); once both slots are filled the add trigger is hidden.
const MAX_CONTACTS = 2;

type LocationContactsModalProps = {
  canManage: boolean;
  locationName: string;
  rows: LocationContact[];
  phoneCountry: string | null;
  // Only read when canManage is true.
  upsertAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  // Passed through to the panel's empty state: this dialog covers the header
  // pill that would otherwise carry the same fact.
  keeper?: LocationKeeper;
};

// The contacts manager, opened from an icon button in the location header.
// The dialog lists the location's contacts (or an empty state) and, when the
// caller can manage them, offers an add trigger in its header and per-row
// edit/delete inside the list — both of which open LocationContactFormModal
// stacked on top of this dialog. Any rep can open it to read; the write
// affordances are simply absent when canManage is false. The button carries a
// count badge so the header still communicates "how many contacts" at a glance
// without a separate card.
export function LocationContactsModal({
  canManage,
  locationName,
  rows,
  phoneCountry,
  upsertAction,
  deleteAction,
  keeper,
}: LocationContactsModalProps) {
  const t = useTranslations("field.location");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dialog = (
    <dialog aria-labelledby={titleId} className="modal-dialog" ref={dialogRef}>
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{t("contactsTitle")}</h2>
          <p className="modal-subtitle">{locationName}</p>
        </div>
        <div className="modal-header-actions">
          {canManage && upsertAction && rows.length < MAX_CONTACTS ? (
            <LocationContactFormModal
              action={upsertAction}
              canManage={canManage}
              locationName={locationName}
              mode="add"
              phoneCountry={phoneCountry}
            />
          ) : null}
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>
      </div>
      <div className="modal-body">
        <LocationContactsPanel
          canManage={canManage}
          deleteAction={deleteAction}
          keeper={keeper}
          locationName={locationName}
          phoneCountry={phoneCountry}
          rows={rows}
          upsertAction={upsertAction}
        />
      </div>
    </dialog>
  );

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t("contactsTitle")}
        className="icon-button location-header-icon"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <UserIcon size={20} />
        {rows.length > 0 ? (
          <span className="location-header-icon-badge">{rows.length}</span>
        ) : null}
      </button>
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
