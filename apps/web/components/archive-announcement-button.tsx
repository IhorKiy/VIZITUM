"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { TrashIcon } from "./icons";

type ArchiveAnnouncementButtonProps = {
  announcementId: string;
  announcementTitle: string;
  archiveAction: (formData: FormData) => Promise<void>;
};

// Withdrawing takes a live notice off every representative's screen mid-run,
// so it asks first: the second click is a different button in a different
// place, not the same one twice.
export function ArchiveAnnouncementButton({
  announcementId,
  announcementTitle,
  archiveAction,
}: ArchiveAnnouncementButtonProps) {
  const t = useTranslations("manager.announcements");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={archiveAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("archive")}
      fieldName="announcementId"
      id={announcementId}
      pendingLabel={t("archiving")}
      promptText={t("archivePrompt")}
      renderTrigger={({ onClick, ref }) => (
        <button
          aria-label={t("archiveAria", { title: announcementTitle })}
          className="name-edit-button is-danger"
          onClick={onClick}
          ref={ref}
          title={t("archive")}
          type="button"
        >
          <TrashIcon />
        </button>
      )}
      variantClassName="confirm-action-inline"
    />
  );
}
