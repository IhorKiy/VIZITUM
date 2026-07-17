"use client";

import { useRef, useTransition } from "react";
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

// The pill is the control, not a button that reveals one: a real select lies
// invisibly over it, so a single click opens the native list. Revealing a
// select on click and focusing it took a second click to open, since focusing
// a select does not drop its list down.
export function TaskStatusEditor({
  taskId,
  status,
  ariaLabel,
  updateAction,
}: TaskStatusEditorProps) {
  const tCommon = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const selectRef = useRef<HTMLSelectElement>(null);
  // True while the user is arrowing through options: a closed select fires
  // `change` on every arrow press, and saving each one would commit every
  // intermediate status. Keyboard changes commit on Enter/blur instead; mouse
  // picks (the flag resets on mousedown) still save immediately.
  const keyboardNavRef = useRef(false);

  function save(next: string) {
    if (next === status) {
      return;
    }

    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("status", next);
    startTransition(() => {
      void updateAction(formData);
    });
  }

  return (
    <span className="task-status">
      <span className={`status-pill ${taskStatusTone(status)}`}>
        {formatEnumLabel(tCommon, status)}
      </span>
      <ChevronDownIcon />
      <select
        aria-label={ariaLabel}
        className="task-status-select"
        defaultValue={status}
        disabled={pending}
        // A saved status arrives as a re-render, not a remount, so re-key the
        // select on it to drop any value the user left uncommitted.
        key={status}
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
            // Put the served status back so the blur below saves nothing.
            if (selectRef.current) {
              selectRef.current.value = status;
            }
            selectRef.current?.blur();
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
    </span>
  );
}
