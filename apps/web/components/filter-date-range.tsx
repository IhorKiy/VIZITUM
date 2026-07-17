import { CalendarIcon } from "./icons";

type FilterDateRangeProps = {
  label: string;
  fromLabel: string;
  toLabel: string;
  fromName: string;
  toName: string;
  fromValue: string;
  toValue: string;
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
}: FilterDateRangeProps) {
  return (
    <div
      aria-label={label}
      className="filter-field filter-field--range"
      role="group"
    >
      <span className="filter-field-label">{label}</span>
      <div className="filter-date-range">
        <span className="filter-field-control">
          <span aria-hidden="true" className="filter-field-icon">
            <CalendarIcon />
          </span>
          <input
            aria-label={fromLabel}
            defaultValue={fromValue}
            name={fromName}
            type="date"
          />
        </span>
        <span aria-hidden="true" className="filter-date-range-dash">
          —
        </span>
        <span className="filter-field-control">
          <span aria-hidden="true" className="filter-field-icon">
            <CalendarIcon />
          </span>
          <input
            aria-label={toLabel}
            defaultValue={toValue}
            name={toName}
            type="date"
          />
        </span>
      </div>
    </div>
  );
}
