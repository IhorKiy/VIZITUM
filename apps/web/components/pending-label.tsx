import type { ReactNode } from "react";

import { LoaderIcon } from "./icons";

type PendingLabelProps = {
  /** Pass `null` for icon-only buttons, where the spinner is the whole state. */
  label?: ReactNode;
};

/**
 * What a button shows while its action is in flight. The spinner is the part
 * that carries the message: a swapped-in "Saving..." reads as a label that
 * merely changed, and on the entry screens — where the wait is a login round
 * trip plus a full page render — a still button read as a tap that never
 * landed. A moving spinner says "still working" without anyone parsing text.
 */
export function PendingLabel({ label }: PendingLabelProps) {
  return (
    <span className="pending-label">
      <LoaderIcon />
      {label}
    </span>
  );
}
