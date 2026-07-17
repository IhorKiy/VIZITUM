"use client";

import { useState } from "react";

import { CalendarIcon } from "./icons";

type DateFieldProps = {
  ariaLabel: string;
  defaultValue: string;
  name: string;
  placeholder: string;
};

// A date input's empty text is the browser's own format hint (dd.mm.yyyy) and
// no attribute can replace it, so an empty field paints our mask over a hidden
// hint. Focus hands the field back to the browser: partial input only reaches
// `value` once the date is complete, so hiding the hint while typing would type
// into an invisible field.
function DateField({
  ariaLabel,
  defaultValue,
  name,
  placeholder,
}: DateFieldProps) {
  const [isEmpty, setIsEmpty] = useState(defaultValue === "");

  return (
    <span className="filter-field-control">
      <span aria-hidden="true" className="filter-field-icon">
        <CalendarIcon />
      </span>
      <input
        aria-label={ariaLabel}
        data-empty={isEmpty ? "" : undefined}
        defaultValue={defaultValue}
        name={name}
        onChange={(event) => setIsEmpty(event.currentTarget.value === "")}
        type="date"
      />
      {isEmpty ? (
        <span aria-hidden="true" className="filter-date-placeholder">
          {placeholder}
        </span>
      ) : null}
    </span>
  );
}

type FilterDateRangeProps = {
  label: string;
  fromLabel: string;
  toLabel: string;
  fromName: string;
  toName: string;
  fromValue: string;
  toValue: string;
  placeholder: string;
};

// The two ends of a date filter read as one field: a single group label above,
// the bounds side by side under it. Each input keeps its own accessible name,
// since the group label alone would not say which end is which.
export function FilterDateRange({
  label,
  fromLabel,
  toLabel,
  fromName,
  toName,
  fromValue,
  toValue,
  placeholder,
}: FilterDateRangeProps) {
  return (
    <div
      aria-label={label}
      className="filter-field filter-field--range"
      role="group"
    >
      <span className="filter-field-label">{label}</span>
      <div className="filter-date-range">
        <DateField
          ariaLabel={fromLabel}
          defaultValue={fromValue}
          name={fromName}
          placeholder={placeholder}
        />
        <span aria-hidden="true" className="filter-date-range-dash">
          —
        </span>
        <DateField
          ariaLabel={toLabel}
          defaultValue={toValue}
          name={toName}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
