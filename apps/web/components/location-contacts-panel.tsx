import { useTranslations } from "next-intl";

import type { LocationContact } from "../lib/api-client";
import { formatPhoneForDisplay, phoneHref } from "../lib/phone";
import { MailIcon, PhoneIcon, TrashIcon, UserIcon } from "./icons";
import { LocationContactFormModal } from "./location-contact-form-modal";
import { PendingSubmitButton } from "./pending-submit-button";

type LocationContactsPanelProps = {
  rows: LocationContact[];
  canManage: boolean;
  // Only read when canManage is true.
  upsertAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  locationName: string;
  phoneCountry: string | null;
};

// Body of the contacts manager modal. A location holds at most two contacts,
// so every contact renders fully expanded (name + phone/email/notes) rather
// than behind an accordion — nothing to collapse. Per-row edit/delete sit next
// to the name when the caller can manage; the edit opens LocationContactFormModal
// stacked on top.
export function LocationContactsPanel({
  rows,
  canManage,
  upsertAction,
  deleteAction,
  locationName,
  phoneCountry,
}: LocationContactsPanelProps) {
  const t = useTranslations("field.location");

  return (
    <div className="field-card-list">
      {rows.length === 0 ? (
        <div className="empty-state-panel location-insights-empty">
          <span className="location-insights-empty-icon" aria-hidden="true">
            <UserIcon size={28} />
          </span>
          <h2>{t("contactsEmptyTitle")}</h2>
          {/* Same split as the potential and assortment panels. On this field
              screen the writer is the assigned representative — the tenant-wide
              contacts tier belongs to the admin roles, which review locations
              elsewhere, and a team_manager holds neither tier — so an
              unassigned reader is told who adds them rather than to add them. */}
          <p>
            {canManage
              ? t("contactsEmptyHint")
              : t("contactsEmptyReadOnlyHint")}
          </p>
        </div>
      ) : null}

      {rows.map((row) => (
        <article className="location-contact-card" key={row.id}>
          <div className="location-contact-card-head">
            <h3>{row.name}</h3>
            {canManage && upsertAction && deleteAction ? (
              <div className="location-insight-card-actions">
                <LocationContactFormModal
                  action={upsertAction}
                  canManage={canManage}
                  locationName={locationName}
                  mode="edit"
                  phoneCountry={phoneCountry}
                  row={row}
                />
                <form action={deleteAction}>
                  <input name="contactId" type="hidden" value={row.id} />
                  <PendingSubmitButton
                    aria-label={t("removeContactAria", { name: row.name })}
                    className="location-insight-action location-insight-action--danger"
                    pendingLabel="…"
                  >
                    <TrashIcon />
                  </PendingSubmitButton>
                </form>
              </div>
            ) : null}
          </div>
          {row.phone || row.email ? (
            <div className="location-contact-lines">
              {row.phone ? (
                <a
                  className="location-contact-line"
                  href={phoneHref(row.phone)}
                >
                  <span
                    className="location-contact-line-icon"
                    aria-hidden="true"
                  >
                    <PhoneIcon />
                  </span>
                  {formatPhoneForDisplay(row.phone, phoneCountry)}
                </a>
              ) : null}
              {row.email ? (
                <a
                  className="location-contact-line"
                  href={`mailto:${row.email}`}
                >
                  <span
                    className="location-contact-line-icon"
                    aria-hidden="true"
                  >
                    <MailIcon />
                  </span>
                  {row.email}
                </a>
              ) : null}
            </div>
          ) : null}
          {row.notes ? <p className="location-note-text">{row.notes}</p> : null}
        </article>
      ))}
    </div>
  );
}
