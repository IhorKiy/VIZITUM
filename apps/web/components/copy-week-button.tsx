"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";

type CopyWeekButtonProps = {
  copyAction: (formData: FormData) => Promise<void>;
  weekStart: string;
};

/**
 * Copies the week on screen into the next one. Text, not an icon: it sits in
 * the day list's section head where the design puts a labelled action, and
 * "copy" alone would not say *which way* the week travels — the month copy
 * next door pulls in the opposite direction.
 */
export function CopyWeekButton({ copyAction, weekStart }: CopyWeekButtonProps) {
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={copyAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("weekCopyConfirm")}
      fieldName="weekStart"
      id={weekStart}
      pendingLabel={t("copyingWeek")}
      promptText={t("weekCopyAction")}
      renderTrigger={({ onClick, ref }) => (
        <button
          className="week-copy-button"
          onClick={onClick}
          ref={ref}
          title={t("weekCopyAction")}
          type="button"
        >
          {t("copyWeek")}
        </button>
      )}
      variantClassName="confirm-action-inline"
    />
  );
}
