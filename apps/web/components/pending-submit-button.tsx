"use client";

import { useTranslations } from "next-intl";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type PendingSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: ReactNode;
};

export function PendingSubmitButton({
  children,
  disabled,
  pendingLabel,
  type = "submit",
  ...props
}: PendingSubmitButtonProps) {
  const t = useTranslations("common");
  const { pending } = useFormStatus();
  const resolvedPendingLabel = pendingLabel ?? t("saving");
  const isDisabled = disabled || pending;

  return (
    <button
      {...props}
      aria-disabled={isDisabled}
      disabled={isDisabled}
      type={type}
    >
      {pending ? resolvedPendingLabel : children}
    </button>
  );
}
