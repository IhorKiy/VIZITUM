"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { TaskStatus } from "../lib/api-client";
import { formatEnumLabel } from "../lib/format";
import { taskStatuses, taskStatusTone } from "../lib/task-status";
import { ChevronDownIcon } from "./icons";

type TaskStatusEditorProps = {
  taskId: string;
  status: TaskStatus;
  // Localized aria-label naming the task the control belongs to.
  ariaLabel: string;
  updateAction: (formData: FormData) => Promise<void>;
};

export function TaskStatusEditor({
  taskId,
  status,
  ariaLabel,
  updateAction,
}: TaskStatusEditorProps) {
  const t = useTranslations("manager.tasks");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectRef = useRef<HTMLSelectElement>(null);
  // True while the user is arrowing through options: a closed select fires
  // `change` on every arrow press, and saving each one would commit every
  // intermediate status. Keyboard changes commit on Enter/blur instead; mouse
  // picks (the flag resets on mousedown) still save immediately.
  const keyboardNavRef = useRef(false);

  useEffect(() => {
    if (editing) {
      selectRef.current?.focus();
    }
  }, [editing]);

  // A successful save redirects and RSC-refreshes without remounting, so leave
  // edit mode whenever the incoming status changes.
  useEffect(() => {
    setEditing(false);
  }, [status]);

  function save(next: string) {
    if (next === status) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("status", next);
    startTransition(() => {
      void updateAction(formData);
    });
  }

  if (!editing) {
    return (
      <button
        aria-label={t("editStatus")}
        className="task-status-trigger"
        disabled={pending}
        onClick={() => setEditing(true)}
        title={t("editStatus")}
        type="button"
      >
        <span className={`status-pill ${taskStatusTone(status)}`}>
          {formatEnumLabel(tCommon, status)}
        </span>
        <ChevronDownIcon />
      </button>
    );
  }

  return (
    <select
      aria-label={ariaLabel}
      className="task-status-select"
      defaultValue={status}
      disabled={pending}
      onBlur={() => {
        if (!pending) {
          // Saves an uncommitted keyboard change; save() falls through to
          // plain close when the value is unchanged.
          save(selectRef.current?.value ?? status);
        }
      }}
      onChange={(event) => {
        if (!keyboardNavRef.current) {
          save(event.target.value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
        } else if (event.key === "Enter") {
          // Commit through the blur path so Enter and click-away match.
          event.preventDefault();
          selectRef.current?.blur();
        } else {
          keyboardNavRef.current = true;
        }
      }}
      onMouseDown={() => {
        keyboardNavRef.current = false;
      }}
      ref={selectRef}
    >
      {taskStatuses.map((option) => (
        <option key={option} value={option}>
          {formatEnumLabel(tCommon, option)}
        </option>
      ))}
    </select>
  );
}
