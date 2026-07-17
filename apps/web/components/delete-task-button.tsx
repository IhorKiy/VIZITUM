"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

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
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    const formData = new FormData();
    formData.set("taskId", taskId);
    startTransition(() => {
      void deleteAction(formData);
    });
  }

  if (!confirming) {
    return (
      <button
        aria-label={t("deleteTaskAria", { title: taskTitle })}
        className="name-edit-button is-danger"
        onClick={() => setConfirming(true)}
        title={t("deleteTask")}
        type="button"
      >
        <TrashIcon />
      </button>
    );
  }

  return (
    <div className="task-delete-confirm">
      <span className="task-delete-prompt">{t("deleteTaskPrompt")}</span>
      <button
        className="secondary-button danger"
        disabled={pending}
        onClick={remove}
        type="button"
      >
        {pending ? t("deletingTask") : t("deleteTask")}
      </button>
      <button
        className="secondary-button"
        disabled={pending}
        onClick={() => setConfirming(false)}
        type="button"
      >
        {tCommon("cancel")}
      </button>
    </div>
  );
}
