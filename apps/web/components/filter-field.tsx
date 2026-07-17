import type { ReactNode } from "react";

type FilterFieldProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

// A filter-form control with its name spelled out above it and an icon sitting
// inside the control, which the control's own padding leaves room for.
export function FilterField({ icon, label, children }: FilterFieldProps) {
  return (
    <label className="filter-field">
      <span className="filter-field-label">{label}</span>
      <span className="filter-field-control">
        <span aria-hidden="true" className="filter-field-icon">
          {icon}
        </span>
        {children}
      </span>
    </label>
  );
}
