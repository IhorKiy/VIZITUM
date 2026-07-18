"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";

type ArchiveLocationButtonProps = {
  locationId: string;
  locationName: string;
  archiveAction: (formData: FormData) => Promise<void>;
};

export function ArchiveLocationButton({
  locationId,
  locationName,
  archiveAction,
}: ArchiveLocationButtonProps) {
  const t = useTranslations("admin.locations");

  return (
    <ConfirmActionButton
      action={archiveAction}
      cancelLabel={t("cancel")}
      confirmLabel={t("archiveLocation")}
      fieldName="locationId"
      id={locationId}
      pendingLabel={t("archivingLocation")}
      promptText={t("archiveLocationPrompt", { name: locationName })}
      renderTrigger={({ onClick, ref }) => (
        <button
          className="secondary-button danger"
          onClick={onClick}
          ref={ref}
          type="button"
        >
          {t("archiveLocation")}
        </button>
      )}
      resetKey={locationId}
    />
  );
}
