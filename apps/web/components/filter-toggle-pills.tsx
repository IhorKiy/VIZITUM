type FilterTogglePillsOption = {
  // Ties the pill to the signal it filters for: "priority" wears the gold of
  // .priority-tag, "overdue" the red of .overdue-tag. Plain pills read in the
  // accent, like the status pills next to them.
  tone?: "priority" | "overdue";
  checked: boolean;
  label: string;
  name: string;
};

type FilterTogglePillsProps = {
  ariaLabel: string;
  options: FilterTogglePillsOption[];
};

// Independent on/off refinements of a list, drawn as pills next to
// FilterPills' single-choice row. Checkboxes rather than radios: each one is
// its own query param, and any combination of them is a valid cut. They share
// FilterPills' markup and .filter-pills styling so a row of filters reads as
// one control strip whichever kind of pill it is made of.
export function FilterTogglePills({
  ariaLabel,
  options,
}: FilterTogglePillsProps) {
  return (
    <div aria-label={ariaLabel} className="filter-pills" role="group">
      {options.map((option) => (
        <label
          className={option.tone ? `filter-pill--${option.tone}` : undefined}
          key={option.name}
        >
          <input
            defaultChecked={option.checked}
            name={option.name}
            type="checkbox"
            value="1"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
