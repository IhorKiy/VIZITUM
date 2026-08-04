"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode, RefObject } from "react";

import { PendingLabel } from "./pending-label";

type ConfirmActionButtonProps = {
  fieldName: string;
  id: string;
  action: (formData: FormData) => Promise<void>;
  promptText: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  renderTrigger: (props: {
    onClick: () => void;
    ref: RefObject<HTMLButtonElement | null>;
  }) => ReactNode;
  /** Closes an open prompt when this value changes, for actions that redirect
   * and RSC-refresh without remounting the button. */
  resetKey?: unknown;
  /** Appended to the base "confirm-action" wrapper class, e.g. "confirm-action-inline". */
  variantClassName?: string;
};

export function ConfirmActionButton({
  fieldName,
  id,
  action,
  promptText,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  renderTrigger,
  resetKey,
  variantClassName,
}: ConfirmActionButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Adjusted during render (React's documented pattern for resetting state
  // when a prop changes) rather than in an effect, so there is no extra
  // render showing the stale confirming state.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setConfirming(false);
  }

  // Opening the confirm row unmounts the trigger (and Cancel unmounts the
  // row again), so move focus by hand or it drops to the document body.
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (wasConfirming.current) {
      triggerRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  function run() {
    const formData = new FormData();
    formData.set(fieldName, id);
    // Awaiting inside the transition keeps `pending` true (buttons disabled,
    // pending label shown) until the action settles — a second click during a
    // slow action would hit an already-mutated record and report a false error.
    startTransition(async () => {
      await action(formData);
    });
  }

  if (!confirming) {
    // renderTrigger is always a caller-supplied JSX render prop (forwarding
    // the ref straight onto a <button>), never a function that dereferences
    // .current itself — but that isn't visible to the linter across the
    // component boundary.
    // eslint-disable-next-line react-hooks/refs -- see comment above
    return renderTrigger({
      onClick: () => setConfirming(true),
      ref: triggerRef,
    });
  }

  return (
    <div
      className={["confirm-action", variantClassName, "confirming"]
        .filter(Boolean)
        .join(" ")}
    >
      {/* role="alert": focus lands on the confirm button when the prompt
          opens, so without an announcement a screen reader hears only the
          button's label, never the sentence saying what confirming does. */}
      <span className="confirm-action-prompt" role="alert">
        {promptText}
      </span>
      <div className="confirm-action-buttons">
        <button
          aria-busy={pending}
          className={`secondary-button danger${pending ? " is-pending" : ""}`}
          disabled={pending}
          onClick={run}
          ref={confirmRef}
          type="button"
        >
          {pending ? <PendingLabel label={pendingLabel} /> : confirmLabel}
        </button>
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
