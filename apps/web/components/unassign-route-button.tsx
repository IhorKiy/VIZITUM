"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";

type UnassignRouteButtonProps = {
  routePlanId: string;
  unassignAction: (formData: FormData) => Promise<void>;
};

export function UnassignRouteButton({
  routePlanId,
  unassignAction,
}: UnassignRouteButtonProps) {
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={unassignAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("unassignRouteConfirm")}
      fieldName="routePlanId"
      id={routePlanId}
      pendingLabel={t("unassigningRoute")}
      promptText={t("unassignRoutePrompt")}
      renderTrigger={({ onClick, ref }) => (
        <button
          className="secondary-button danger"
          onClick={onClick}
          ref={ref}
          type="button"
        >
          {t("unassignRoute")}
        </button>
      )}
    />
  );
}
