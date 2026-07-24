"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { CheckIcon, CloseIcon, PencilIcon } from "./icons";

type TaskDetailsEditorProps = {
  taskId: string;
  // Current description ("" when the task has none).
  value: string;
  updateAction: (formData: FormData) => Promise<void>;
  // Rendered next to the pencil once the disclosure is open. The delete button
  // rides along here so it stays out of reach of a stray click on a collapsed
  // card, and the caller decides whether the viewer may see it at all.
  actions?: ReactNode;
};

// The description is its own disclosure: collapsed it shows a single clamped
// line, so a card carries a hint of what the task says instead of a generic
// "details" label. Expanding reveals the rest of the text and the pencil.
export function TaskDetailsEditor({
  taskId,
  value,
  updateAction,
  actions,
}: TaskDetailsEditorProps) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const [expanded, setExpanded] = useState(false);
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
        <button
          aria-expanded={expanded}
          className="task-details-toggle"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          <span
            className={`task-details-text${value ? "" : " is-empty"}${
              expanded ? "" : " is-clamped"
            }`}
          >
            {value || t("noTaskDetails")}
          </span>
        </button>
        {expanded ? (
          <div className="task-details-actions">
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
            {actions}
          </div>
        ) : null}
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
        maxLength={INPUT_LIMITS.notes}
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
