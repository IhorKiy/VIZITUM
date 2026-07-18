"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { TrashIcon } from "./icons";

type DeleteTaskButtonProps = {
  taskId: string;
  taskTitle: string;
  deleteAction: (formData: FormData) => Promise<void>;
};

// Deleting is for tasks created by mistake, so it asks first: the second click
// is a different button in a different place, not the same one twice.
export function DeleteTaskButton({
  taskId,
  taskTitle,
  deleteAction,
}: DeleteTaskButtonProps) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");

  return (
    <ConfirmActionButton
      action={deleteAction}
      cancelLabel={tCommon("cancel")}
      confirmLabel={t("deleteTask")}
      fieldName="taskId"
      id={taskId}
      pendingLabel={t("deletingTask")}
      promptText={t("deleteTaskPrompt")}
      renderTrigger={({ onClick, ref }) => (
        <button
          aria-label={t("deleteTaskAria", { title: taskTitle })}
          className="name-edit-button is-danger"
          onClick={onClick}
          ref={ref}
          title={t("deleteTask")}
          type="button"
        >
          <TrashIcon />
        </button>
      )}
      variantClassName="confirm-action-inline"
    />
  );
}
