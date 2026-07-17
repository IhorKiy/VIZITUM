import type { ReactNode } from "react";

type FilterFieldProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

// A filter-form control labelled by an icon instead of text; the field name
// stays available as a hover tooltip (title) and for screen readers (sr-only).
export function FilterField({ icon, label, children }: FilterFieldProps) {
  return (
    <label>
      <span className="filter-field-icon" title={label}>
        {icon}
        <span className="sr-only">{label}</span>
      </span>
      {children}
    </label>
  );
}
