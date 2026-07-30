"use client";

import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { PendingLabel } from "./pending-label";

type PendingSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * Text shown next to the spinner while the action runs. Omit it for the
   * generic "Saving..."; pass `null` on an icon-only button, where the spinner
   * alone is the pending state.
   */
  pendingLabel?: ReactNode;
};

export function PendingSubmitButton({
  children,
  className,
  disabled,
  pendingLabel,
  type = "submit",
  ...props
}: PendingSubmitButtonProps) {
  const t = useTranslations("common");
  const { pending } = useFormStatus();
  // `??` would swallow a deliberate `null` back into the default label.
  const resolvedPendingLabel =
    pendingLabel === undefined ? t("saving") : pendingLabel;
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      aria-disabled={isDisabled}
      // A busy button and an unavailable one are both `disabled`, and they
      // should not look alike: `is-pending` keeps this one in its own colours
      // so the spinner stays legible (globals.css).
      className={[className, pending ? "is-pending" : null]
        .filter(Boolean)
        .join(" ")}
      disabled={isDisabled}
      type={type}
    >
      {pending ? <PendingLabel label={resolvedPendingLabel} /> : children}
    </button>
  );
}
