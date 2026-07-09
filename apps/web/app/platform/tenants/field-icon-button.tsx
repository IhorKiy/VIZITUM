"use client";

import type { ReactNode } from "react";

type FieldIconButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
};

// A compact icon-only trigger used inside the Tenant information fields so each
// editable value carries its own action (edit / invite / manage) instead of a
// row of wide text buttons in a separate toolbar.
export function FieldIconButton({
  label,
  onClick,
  children,
  disabled,
  title,
}: FieldIconButtonProps) {
  return (
    <button
      aria-label={label}
      className="icon-button tenant-field-icon-button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {children}
    </button>
  );
}

export function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11.333 2.667a1.414 1.414 0 0 1 2 2L5.5 12.5l-2.833.833L3.5 10.5l7.833-7.833Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 3.333v9.334M3.333 8h9.334"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 7.333A2.167 2.167 0 1 0 6 3a2.167 2.167 0 0 0 0 4.333ZM2 13c0-1.84 1.79-3.333 4-3.333s4 1.493 4 3.333"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
      <path
        d="M10.5 3.5a2.167 2.167 0 0 1 0 4M11 9.75c1.53.36 2.5 1.4 2.5 3.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}
