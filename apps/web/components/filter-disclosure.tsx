import type { ReactNode } from "react";

import { ChevronDownIcon, SlidersIcon } from "./icons";

type FilterDisclosureProps = {
  label: string;
  hasFilters: boolean;
  children: ReactNode;
};

// Collapsible panel wrapping a list's filter form: starts open while any filter
// is active, and the dot on the summary keeps the filtered state visible even
// when the panel is collapsed.
export function FilterDisclosure({
  label,
  hasFilters,
  children,
}: FilterDisclosureProps) {
  return (
    <details className="filter-panel" open={hasFilters}>
      <summary className="filter-panel-summary">
        <span className="filter-panel-title">
          <SlidersIcon />
          {label}
          {hasFilters ? (
            <span aria-hidden="true" className="filter-active-dot" />
          ) : null}
        </span>
        <span aria-hidden="true" className="filter-panel-chevron">
          <ChevronDownIcon />
        </span>
      </summary>
      {children}
    </details>
  );
}
