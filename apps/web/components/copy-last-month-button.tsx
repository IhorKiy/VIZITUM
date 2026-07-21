"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { CopyIcon } from "./icons";

type CopyLastMonthButtonProps = {
  copyAction: (formData: FormData) => Promise<void>;
  month: string;
};

export function CopyLastMonthButton({
  copyAction,
  month,
}: CopyLastMonthButtonProps) {
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={copyAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("monthCopyConfirm")}
      fieldName="month"
      id={month}
      pendingLabel={t("copyingMonth")}
      promptText={t("monthCopyAction")}
      renderTrigger={({ onClick, ref }) => (
        <button
          aria-label={t("monthCopyConfirm")}
          className="icon-button is-accent is-borderless"
          onClick={onClick}
          ref={ref}
          title={t("monthCopyConfirm")}
          type="button"
        >
          <CopyIcon />
        </button>
      )}
      variantClassName="confirm-action-inline"
    />
  );
}
