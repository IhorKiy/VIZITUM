type FilterPillsOption = {
  label: string;
  value: string;
};

type FilterPillsProps = {
  ariaLabel: string;
  name: string;
  // The "any" choice carries an empty value: the filter form drops empty
  // fields, so picking it simply leaves the param out of the URL.
  options: FilterPillsOption[];
  value: string;
};

// A list's primary cut (status, priority, activity) as one-click pills. These
// are ordinary radio fields of the surrounding FilterForm rather than links, so
// the pills and the filter panel share one state, one soft navigation and one
// reset — the pills just stay visible instead of living behind the disclosure.
export function FilterPills({
  ariaLabel,
  name,
  options,
  value,
}: FilterPillsProps) {
  return (
    <div aria-label={ariaLabel} className="filter-pills" role="radiogroup">
      {options.map((option) => (
        <label key={option.value || "any"}>
          <input
            defaultChecked={option.value === value}
            name={name}
            type="radio"
            value={option.value}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
