"use client";

import { useId } from "react";

type InfoHintProps = {
  text: string;
  label: string;
};

// A focusable info affordance whose bubble is revealed on hover/focus via CSS.
// The trigger keeps a short accessible name (`aria-label`) and points at the
// bubble with `aria-describedby` so screen readers announce the detail text —
// `aria-label` alone would replace the bubble in the accessibility tree.
// Stops click/mousedown from bubbling so a hint sitting inside a <summary>
// doesn't toggle the surrounding disclosure.
export function InfoHint({ text, label }: InfoHintProps) {
  const bubbleId = useId();

  return (
    <span
      aria-describedby={bubbleId}
      aria-label={label}
      className="info-hint"
      onClick={(event) => {
        // preventDefault cancels the <summary> toggle (its default action);
        // stopPropagation keeps the click off any ancestor handlers.
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      role="note"
      tabIndex={0}
    >
      <InfoIcon />
      <span className="info-hint-bubble" id={bubbleId} role="tooltip">
        {text}
      </span>
    </span>
  );
}

function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}
