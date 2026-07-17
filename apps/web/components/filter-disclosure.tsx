"use client";

import { useState, type ReactNode } from "react";

import { ChevronDownIcon, SlidersIcon } from "./icons";

type FilterDisclosureProps = {
  label: string;
  hasFilters: boolean;
  children: ReactNode;
};

// Collapsible panel wrapping a list's filter form: starts open while any filter
// is active, and the dot on the summary keeps the filtered state visible even
// when the panel is collapsed. The open state is seeded from hasFilters, not
// driven by it: filters apply through a soft router.replace, so clearing the
// last filter re-renders with hasFilters false — following the prop then would
// slam the panel shut under the cursor mid-typing.
export function FilterDisclosure({
  label,
  hasFilters,
  children,
}: FilterDisclosureProps) {
  const [open, setOpen] = useState(hasFilters);

  return (
    <details
      className="filter-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
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
