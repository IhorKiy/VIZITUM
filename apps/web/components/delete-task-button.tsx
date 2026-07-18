"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Opening the confirm row unmounts the trash button (and Cancel unmounts
  // the row again), so move focus by hand or it drops to the document body.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (wasConfirming.current) {
      triggerRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  function remove() {
    const formData = new FormData();
    formData.set("taskId", taskId);
    // Awaiting inside the transition keeps `pending` true (buttons disabled,
    // "Deleting…" shown) until the action settles — a second click during a
    // slow delete would hit an already-deleted task and report a false error.
    startTransition(async () => {
      await deleteAction(formData);
    });
  }

  if (!confirming) {
    return (
      <button
        aria-label={t("deleteTaskAria", { title: taskTitle })}
        className="name-edit-button is-danger"
        onClick={() => setConfirming(true)}
        ref={triggerRef}
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
        ref={confirmRef}
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
