/**
 * How much is behind a filter pill, in the pill.
 *
 * The counts are what make a filter row worth reading rather than worth
 * tapping: a rep learns how much is open, how much is late, how many visits
 * were cancelled without opening any of them.
 *
 * `undefined` renders nothing at all — not a zero. The counts come from an
 * aggregate the list response carries, and a build serving against the previous
 * API for a minute or two mid-deploy has no aggregate; "0" beside a filter that
 * would show rows is worse than a pill with no number on it.
 */
export function FilterCount({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return null;
  }

  return <b className="filter-pill-count">{value}</b>;
}
