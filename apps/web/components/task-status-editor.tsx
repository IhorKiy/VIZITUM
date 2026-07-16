"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { TaskStatus } from "../lib/api-client";
import { formatEnumLabel } from "../lib/format";
import { ChevronDownIcon } from "./icons";

const STATUSES: TaskStatus[] = ["open", "in_progress", "done", "cancelled"];

function statusTone(status: TaskStatus): "active" | "info" | "warning" {
  if (status === "done") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}

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
        <span className={`status-pill ${statusTone(status)}`}>
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
          setEditing(false);
        }
      }}
      onChange={(event) => save(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
        }
      }}
      ref={selectRef}
    >
      {STATUSES.map((option) => (
        <option key={option} value={option}>
          {formatEnumLabel(tCommon, option)}
        </option>
      ))}
    </select>
  );
}
