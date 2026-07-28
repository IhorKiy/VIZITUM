import { useTranslations } from "next-intl";

import {
  VISIT_PERIOD_PRESETS,
  visitPeriodPresetRange,
  type VisitPeriod,
} from "../lib/visit-period";

type VisitPeriodPillsProps = {
  // Tenant-relative screen the pills navigate back to, e.g. "/acme/field/history".
  action: string;
  period: VisitPeriod;
  // Every other filter currently in the URL. Carried through so switching the
  // period keeps the status pill, the representative, the location.
  otherParams: URLSearchParams;
  timeZone: string;
};

/**
 * How deep a visit list reads, as one row of pills above it.
 *
 * Links rather than the radio fields the status pills use: a preset writes two
 * params at once (`startedFrom` and `startedTo`), which no single form control
 * can express, and the resolved dates have to reach the URL so returning to
 * this screen — from a visit card, from a shared link — lands on the same
 * window rather than on a relative one that has since slid.
 *
 * The last pill opens the date range in the filter panel instead of naming a
 * window of its own: the presets cover the periods people ask for by name, and
 * anything else is a range someone picks by hand.
 */
export function VisitPeriodPills({
  action,
  period,
  otherParams,
  timeZone,
}: VisitPeriodPillsProps) {
  const t = useTranslations("common.visitPeriod");
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
    // role="group" is what makes the aria-label count: a plain div takes no
    // accessible name, so without it the row of period links would announce
    // as four loose links with nothing saying what they select.
    <div
      aria-label={t("pillsAria")}
      className="filter-pills filter-pills--links"
      role="group"
    >
      {VISIT_PERIOD_PRESETS.map((preset) => (
        <a
          aria-current={period.preset === preset ? "true" : undefined}
          href={hrefFor(visitPeriodPresetRange(preset, timeZone))}
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
          startedFrom: period.startedFrom,
          startedTo: period.startedTo,
          period: "custom",
        })}
      >
        {t("customPill")}
      </a>
    </div>
  );
}
