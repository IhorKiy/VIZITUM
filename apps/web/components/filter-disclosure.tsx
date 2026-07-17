import type { ReactNode } from "react";

type FilterDisclosureProps = {
  label: string;
  hasFilters: boolean;
  children: ReactNode;
};

// Collapsible wrapper for a list's filter form: starts open while any filter
// is active, and the dot on the summary keeps the filtered state visible even
// when the disclosure is collapsed.
export function FilterDisclosure({
  label,
  hasFilters,
  children,
}: FilterDisclosureProps) {
  return (
    <details className="filter-disclosure" open={hasFilters}>
      <summary className="filter-disclosure-summary">
        {label}
        {hasFilters ? (
          <span aria-hidden="true" className="filter-active-dot" />
        ) : null}
      </summary>
      {children}
    </details>
  );
}
