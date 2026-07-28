import { useTranslations } from "next-intl";

import {
  PERIOD_PRESETS,
  periodPresetRange,
  periodSearchParams,
  type Period,
  type PeriodParamNames,
} from "../lib/period";

type PeriodPillsProps = {
  // Tenant-relative screen the pills navigate back to, e.g. "/acme/field/history".
  action: string;
  // What this row of pills selects, e.g. "Visit period". A plain div takes no
  // accessible name, so without it the row announces as four loose links with
  // nothing saying what they are for.
  ariaLabel: string;
  // The two URL parameters this screen carries its window in.
  names: PeriodParamNames;
  period: Period;
  // Every other filter currently in the URL. Carried through so switching the
  // period keeps the status pill, the representative, the location.
  otherParams: URLSearchParams;
  timeZone: string;
};

/**
 * How deep a list reads, as one row of pills above it.
 *
 * Links rather than the radio fields the status pills use: a preset writes two
 * params at once, which no single form control can express, and the resolved
 * dates have to reach the URL so returning to this screen — from a card, from a
 * shared link — lands on the same window rather than on a relative one that has
 * since slid.
 *
 * The last pill opens the date range in the filter panel instead of naming a
 * window of its own: the presets cover the periods people ask for by name, and
 * anything else is a range someone picks by hand.
 */
export function PeriodPills({
  action,
  ariaLabel,
  names,
  period,
  otherParams,
  timeZone,
}: PeriodPillsProps) {
  const t = useTranslations("common.period");
  const hrefFor = (params: Record<string, string>) => {
    const search = new URLSearchParams(otherParams);

    // A new window restarts the list: page 3 of the old one means nothing in
    // the new one.
    search.delete("page");

    for (const [name, value] of Object.entries(params)) {
      search.set(name, value);
    }

    const query = search.toString();

    return query ? `${action}?${query}` : action;
  };

  return (
    <div
      aria-label={ariaLabel}
      className="filter-pills filter-pills--links"
      role="group"
    >
      {PERIOD_PRESETS.map((preset) => (
        <a
          aria-current={period.preset === preset ? "true" : undefined}
          href={hrefFor(
            periodSearchParams(periodPresetRange(preset, timeZone), names),
          )}
          key={preset}
        >
          {t(`presetPill.${preset}`)}
        </a>
      ))}
      <a
        aria-current={period.preset === "custom" ? "true" : undefined}
        // The current window rides along so the date fields in the panel open
        // on the period being read, not on two empty inputs.
        href={hrefFor({
          ...periodSearchParams(period, names),
          period: "custom",
        })}
      >
        {t("customPill")}
      </a>
    </div>
  );
}
