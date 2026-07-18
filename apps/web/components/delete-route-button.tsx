"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { TrashIcon } from "./icons";

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
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={deleteAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("deleteRouteConfirm")}
      fieldName="templateId"
      id={routeId}
      pendingLabel={t("deletingRoute")}
      promptText={t("deleteRoutePrompt")}
      renderTrigger={({ onClick, ref }) => (
        <button
          aria-label={t("deleteRouteAria", { name: routeName })}
          className="icon-button"
          onClick={onClick}
          ref={ref}
          title={t("deleteRoute")}
          type="button"
        >
          <TrashIcon />
        </button>
      )}
    />
  );
}
