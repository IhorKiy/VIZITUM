"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { getFormString } from "../lib/form";
import { INPUT_LIMITS } from "../lib/input-limits";
import { PencilIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

// A successful save ends in a redirect (the action never resolves with a
// value); a failed one must NOT redirect — a redirect remounts the page tree
// and wipes what was typed — so it resolves with { ok: false } and the
// still-mounted dialog keeps the draft.
export type AnnouncementActionResult = { ok: false } | void;

type AnnouncementDraft = {
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
};

type AnnouncementModalProps = {
  action: (formData: FormData) => Promise<AnnouncementActionResult>;
  /** Absent for the create dialog; the row being edited otherwise. */
  announcement?: {
    id: string;
    title: string;
    body: string;
    startsAt: string;
    endsAt: string;
  };
  /** Today in the tenant's timezone, used as the create form's default start. */
  todayIsoDate: string;
  /**
   * How the opener renders: the header's primary "New announcement" button, or
   * the pencil beside a row. A render prop would be the obvious shape here and
   * is the wrong one — this is a client component opened from a server page,
   * and a function prop cannot cross that boundary (it fails only at render
   * time, never at typecheck).
   */
  trigger?: "primary" | "icon";
  /** Required for the icon trigger, which carries no visible text. */
  triggerAriaLabel?: string;
  triggerTitle?: string;
};

export function AnnouncementModal({
  action,
  announcement,
  todayIsoDate,
  trigger = "primary",
  triggerAriaLabel,
  triggerTitle,
}: AnnouncementModalProps) {
  const t = useTranslations("manager.announcementModal");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const isEdit = Boolean(announcement);
  // One `?announcement=` param drives every dialog on the page: "new" for the
  // create one, a row id for that row's edit one. Keeping them on the same
  // param means opening one always closes the others.
  const openValue = announcement ? announcement.id : "new";

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const shouldOpen = searchParams.get("announcement") === openValue;

    if (shouldOpen && !dialog.open) {
      openDialog();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }, [searchParams, openValue]);

  // Opening always starts from the stored values (or a blank form on create),
  // discarding any draft left over from an earlier failed submit.
  function openDialog() {
    setDraft(null);
    setSubmitFailed(false);
    setFormVersion((version) => version + 1);
    dialogRef.current?.showModal();
  }

  // Drops the param so a refresh after closing doesn't reopen the dialog. A
  // successful save never reaches this: it redirects instead.
  function clearAnnouncementParam() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("announcement");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
    clearAnnouncementParam();
  }

  // React resets the (uncontrolled) form once the action settles, so a failed
  // save captures the submitted values first and feeds them back as the
  // remounted form's default values.
  async function submitAction(formData: FormData) {
    setSubmitFailed(false);

    const values: AnnouncementDraft = {
      title: getFormString(formData, "title"),
      body: getFormString(formData, "body"),
      startsAt: getFormString(formData, "startsAt"),
      endsAt: getFormString(formData, "endsAt"),
    };
    const result = await action(formData);

    if (result?.ok === false) {
      setDraft(values);
      setSubmitFailed(true);
      setFormVersion((version) => version + 1);
    }
  }

  const titleId = `announcement-modal-${openValue}`;

  return (
    <>
      {trigger === "icon" ? (
        <button
          aria-haspopup="dialog"
          aria-label={triggerAriaLabel}
          className="name-edit-button"
          onClick={openDialog}
          title={triggerTitle}
          type="button"
        >
          <PencilIcon />
        </button>
      ) : (
        <button
          aria-haspopup="dialog"
          className="primary-button"
          onClick={openDialog}
          type="button"
        >
          {t("createTitle")}
        </button>
      )}

      <dialog
        aria-labelledby={titleId}
        className="modal-dialog"
        onClose={clearAnnouncementParam}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{isEdit ? t("editTitle") : t("createTitle")}</h2>
          </div>
          <button
            aria-label={tCommon("cancel")}
            className="icon-button"
            onClick={() => closeDialog()}
            type="button"
          >
            ×
          </button>
        </div>

        {submitFailed ? (
          <div className="form-error" role="alert">
            {t("errorBody")}
          </div>
        ) : null}

        <form
          action={submitAction}
          className="visit-form compact modal-form"
          key={formVersion}
        >
          {announcement ? (
            <input
              name="announcementId"
              type="hidden"
              value={announcement.id}
            />
          ) : null}
          <label>
            {t("formTitle")}
            <input
              defaultValue={draft?.title ?? announcement?.title ?? ""}
              maxLength={INPUT_LIMITS.title}
              name="title"
              placeholder={t("formTitlePlaceholder")}
              required
              type="text"
            />
          </label>
          <label>
            {t("formBody")}
            <textarea
              defaultValue={draft?.body ?? announcement?.body ?? ""}
              maxLength={INPUT_LIMITS.notes}
              name="body"
              placeholder={t("formBodyPlaceholder")}
              required
              rows={5}
            />
          </label>
          <div className="form-row">
            <label>
              {t("formStartsAt")}
              <input
                defaultValue={
                  draft?.startsAt ?? announcement?.startsAt ?? todayIsoDate
                }
                name="startsAt"
                required
                type="date"
              />
            </label>
            <label>
              {t("formEndsAt")}
              <input
                defaultValue={draft?.endsAt ?? announcement?.endsAt ?? ""}
                name="endsAt"
                required
                type="date"
              />
            </label>
          </div>
          <p className="form-hint">{t("formWindowHint")}</p>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => closeDialog()}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("saving")}
            >
              {isEdit ? tCommon("save") : t("publish")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
