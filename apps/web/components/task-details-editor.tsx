"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { CheckIcon, CloseIcon, PencilIcon } from "./icons";

type TaskDetailsEditorProps = {
  taskId: string;
  // Current description ("" when the task has none).
  value: string;
  updateAction: (formData: FormData) => Promise<void>;
};

export function TaskDetailsEditor({
  taskId,
  value,
  updateAction,
}: TaskDetailsEditorProps) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  // A successful save redirects and RSC-refreshes the page without remounting
  // this component, so leave edit mode whenever the incoming value changes.
  useEffect(() => {
    setEditing(false);
  }, [value]);

  function save() {
    const next = (textareaRef.current?.value ?? "").trim();

    if (next === value) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("description", next);
    startTransition(() => {
      void updateAction(formData);
    });
  }

  if (!editing) {
    return (
      <div className="task-details">
        <p className={`list-card-desc${value ? "" : " is-empty"}`}>
          {value || t("noTaskDetails")}
        </p>
        <button
          aria-label={t("editDetails")}
          className="name-edit-button"
          disabled={pending}
          onClick={() => setEditing(true)}
          title={t("editDetails")}
          type="button"
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="task-details is-editing">
      <textarea
        aria-label={t("editDetails")}
        className="task-details-input"
        defaultValue={value}
        disabled={pending}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          } else if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            save();
          }
        }}
        placeholder={t("editDetailsPlaceholder")}
        ref={textareaRef}
        rows={3}
      />
      <div className="task-details-actions">
        <button
          aria-label={tCommon("save")}
          className="name-edit-button"
          disabled={pending}
          onClick={save}
          title={tCommon("save")}
          type="button"
        >
          <CheckIcon />
        </button>
        <button
          aria-label={tCommon("cancel")}
          className="name-edit-button"
          disabled={pending}
          onClick={() => setEditing(false)}
          title={tCommon("cancel")}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
