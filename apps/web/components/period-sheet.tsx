import { useTranslations } from "next-intl";

import { FilterDateRange } from "./filter-date-range";
import { FilterForm } from "./filter-form";
import { Sheet } from "./sheet";
import {
  PERIOD_PICKER_VALUE,
  PERIOD_PRESETS,
  periodPresetRange,
  periodSearchParams,
  type Period,
  type PeriodParamNames,
} from "../lib/period";

type PeriodSheetProps = {
  // Tenant-relative screen the picker belongs to, e.g. "/acme/field/history".
  action: string;
  // Where the screen lives with the picker closed — this URL minus `period`.
  closeHref: string;
  fromLabel: string;
  // The two URL parameters this screen carries its window in.
  names: PeriodParamNames;
  // Every other filter currently in the URL. Carried through so picking a
  // window keeps the status chip the list was read under.
  otherParams: URLSearchParams;
  period: Period;
  // Back to the unasked-for default window. Omitted while the list is already
  // reading it, where there is nothing to undo.
  resetHref?: string;
  timeZone: string;
  toLabel: string;
};

/**
 * The window picker: the three named periods, and the two dates for anything
 * else, in a sheet over the list.
 *
 * A sheet rather than a panel above the list, because the window is asked about
 * rarely and the list is read constantly — the old row of preset links plus a
 * filter disclosure spent a third of a phone's first screenful on a control
 * most sessions never touch, and pushed the newest visit below the fold.
 *
 * The two halves behave differently on purpose. A preset is a whole answer, so
 * tapping one applies it *and* closes the sheet — its links simply omit
 * `period`. A hand-picked range is two decisions, so its form keeps the picker
 * open (`period=picker` rides along as a hidden field) and the list updates
 * behind the sheet as each end is set; the reader closes it when the range says
 * what they meant.
 */
export function PeriodSheet({
  action,
  closeHref,
  fromLabel,
  names,
  otherParams,
  period,
  resetHref,
  timeZone,
  toLabel,
}: PeriodSheetProps) {
  const t = useTranslations("common.period");
  const tCommon = useTranslations("common");
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
    <Sheet
      ariaLabel={t("sheetTitle")}
      closeHref={closeHref}
      closeLabel={tCommon("close")}
      eyebrow={<span className="sheet-eyebrow-title">{t("sheetTitle")}</span>}
    >
      <div className="sheet-body period-sheet-body">
        <div
          aria-label={t("presetsAria")}
          className="period-sheet-presets"
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
              {t(`presetShort.${preset}`)}
            </a>
          ))}
        </div>

        {/* `filter-form` for the field styling every other date range on the
            product wears — the columns it comes with are overridden, the inputs
            are the point. */}
        <FilterForm action={action} className="filter-form period-sheet-range">
          {/* The rest of the URL, as fields: this form replaces the query
              rather than adding to it, so anything left out here is dropped
              the moment a date changes. */}
          {[...otherParams.entries()].map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <input name="period" type="hidden" value={PERIOD_PICKER_VALUE} />
          {/* Seeded with the resolved window rather than with whatever the URL
              happened to carry: editing one end of the default period should
              narrow those 30 days, not open an unbounded range. */}
          <FilterDateRange
            fromLabel={fromLabel}
            fromName={names.from}
            fromValue={period.from}
            label={t("customLabel")}
            placeholder={tCommon("datePlaceholder")}
            toLabel={toLabel}
            toName={names.to}
            toValue={period.to}
          />
        </FilterForm>

        {resetHref ? (
          <div className="period-sheet-footer">
            <a className="secondary-button" href={resetHref}>
              {tCommon("reset")}
            </a>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
