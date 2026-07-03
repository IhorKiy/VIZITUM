"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type PendingSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: ReactNode;
};

export function PendingSubmitButton({
  children,
  disabled,
  pendingLabel = "Saving...",
  type = "submit",
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      aria-disabled={isDisabled}
      disabled={isDisabled}
      type={type}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
