"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { TrashIcon } from "./icons";

type UnassignRouteButtonProps = {
  routePlanId: string;
  routeName: string;
  unassignAction: (formData: FormData) => Promise<void>;
};

export function UnassignRouteButton({
  routePlanId,
  routeName,
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
          aria-label={t("unassignRouteAria", { name: routeName })}
          className="name-edit-button is-danger"
          onClick={onClick}
          ref={ref}
          title={t("unassignRoute")}
          type="button"
        >
          <TrashIcon />
        </button>
      )}
      variantClassName="confirm-action-inline"
    />
  );
}
