"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";
import { MapPinIcon, RouteIcon } from "./icons";
import { PendingLabel } from "./pending-label";
import { datesBetween } from "../lib/planning-month";
import { addDaysToDate, dateToUtcNoon } from "../lib/planning-week";

export type MonthDayPlans = {
  stopCount: number;
  routeNames: string[];
};

export type MonthTemplate = {
  id: string;
  name: string;
  stopCount: number;
};

type MonthCalendarProps = {
  tenantSlug: string;
  /** "2026-08" — the month being drawn, formatted for display here. */
  month: string;
  previousMonthHref: string;
  nextMonthHref: string;
  /** Dates of the month in order, plus the blank cells before the 1st. */
  dates: string[];
  leadingBlanks: number;
  plansByDate: Record<string, MonthDayPlans>;
  today: string;
  anchorDate: string;
  /** Monday of the week `anchorDate` falls in — what the week copy targets. */
  anchorWeekStart: string;
  routeTemplates: MonthTemplate[];
  assignManyAction: (formData: FormData) => Promise<void>;
  copyLastWeekAction: (formData: FormData) => Promise<void>;
};

/**
 * The month grid and the action panel that appears once dates are selected.
 *
 * Client-side because selection is the whole point of this mode and never
 * survives a navigation: `?date=`/`?view=` stay in the URL (the server draws
 * from those), while which dates are ticked is transient state that belongs
 * here. Selecting is deliberately behind a toggle — without one, a plain tap
 * could not also mean "open this day", which is what a reader arriving from
 * the month overview usually wants.
 */
export function MonthCalendar({
  tenantSlug,
  month,
  previousMonthHref,
  nextMonthHref,
  dates,
  leadingBlanks,
  plansByDate,
  today,
  anchorDate,
  anchorWeekStart,
  routeTemplates,
  assignManyAction,
  copyLastWeekAction,
}: MonthCalendarProps) {
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  // Where the last plain tick landed, so a shift-click has something to draw
  // a range from.
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by the long-press timer so the click that ends the press does not
  // then act as an ordinary tap and navigate away from the selection it just
  // started.
  const longPressFired = useRef(false);

  const selected = new Set(selectedDates);

  function weekHref(date: string): string {
    return `/${tenantSlug}/field/planning?view=week&date=${date}`;
  }

  function toggle(date: string, extendRange: boolean) {
    setSelectedDates((current) => {
      if (extendRange && rangeAnchor) {
        const range = datesBetween(rangeAnchor, date);
        // A range adds; it never clears what the reader already ticked
        // elsewhere in the month.
        return [...new Set([...current, ...range])];
      }

      return current.includes(date)
        ? current.filter((value) => value !== date)
        : [...current, date];
    });
    setRangeAnchor(date);
  }

  function activate(date: string, event: { shiftKey: boolean }) {
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }

    if (selectionMode) {
      toggle(date, event.shiftKey);
      return;
    }

    router.push(weekHref(date));
  }

  function beginLongPress(date: string) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setSelectionMode(true);
      setSelectedDates((current) =>
        current.includes(date) ? current : [...current, date],
      );
      setRangeAnchor(date);
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function clearSelection() {
    setSelectionMode(false);
    setSelectedDates([]);
    setRangeAnchor(null);
  }

  /**
   * Arrow keys walk the grid a day (or a week, vertically) at a time, which
   * is the only way to reach a date without a pointer. Focus is moved rather
   * than selection: `Enter`/`Space` still do the choosing, so arrowing across
   * the month cannot tick anything by accident.
   */
  function onGridKeyDown(event: React.KeyboardEvent, date: string) {
    if (event.key === "Escape" && selectionMode) {
      event.preventDefault();
      clearSelection();
      return;
    }

    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];

    if (step === undefined) {
      return;
    }

    const target = cellRefs.current.get(addDaysToDate(date, step));

    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  function assignToSelection(routeTemplateId: string) {
    const formData = new FormData();
    formData.set("routeTemplateId", routeTemplateId);
    formData.set("planDates", selectedDates.join(","));
    dialogRef.current?.close();
    startTransition(async () => {
      await assignManyAction(formData);
    });
  }

  const plannedCount = dates.filter((date) => plansByDate[date]).length;

  return (
    <>
      <div className="panel month-card">
        <div className="route-section-head">
          <Link
            aria-label={t("previousMonth")}
            className="secondary-button is-accent"
            href={previousMonthHref}
          >
            ‹
          </Link>
          <h2 className="month-label">
            {format.dateTime(dateToUtcNoon(`${month}-01`), {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </h2>
          <Link
            aria-label={t("nextMonth")}
            className="secondary-button is-accent"
            href={nextMonthHref}
          >
            ›
          </Link>
        </div>

        <div className="month-summary-row">
          <p className="month-summary">
            {t("monthPlannedSummary", {
              planned: plannedCount,
              total: dates.length,
            })}
          </p>
          <button
            aria-pressed={selectionMode}
            className={`month-select-toggle${selectionMode ? " is-active" : ""}`}
            onClick={() =>
              selectionMode ? clearSelection() : setSelectionMode(true)
            }
            type="button"
          >
            <span aria-hidden="true" className="month-select-box" />
            {t("selectMode")}
          </button>
        </div>

        <div className="month-grid" role="grid" aria-label={t("monthGridAria")}>
          <div className="month-weekdays" role="row">
            {weekdayLabels(format).map((label) => (
              <span
                className="month-weekday"
                key={label}
                role="columnheader"
                aria-label={label}
              >
                {label}
              </span>
            ))}
          </div>
          {monthRows(dates, leadingBlanks).map((row, rowIndex) => (
            <div className="month-row" key={row.key} role="row">
              {row.cells.map((date, cellIndex) =>
                date === null ? (
                  <span
                    className="month-cell-blank"
                    key={`blank-${rowIndex}-${cellIndex}`}
                    role="gridcell"
                  />
                ) : (
                  <span className="month-cell-slot" key={date} role="gridcell">
                    <button
                      aria-label={cellLabel(date, plansByDate[date], format, t)}
                      aria-pressed={
                        selectionMode ? selected.has(date) : undefined
                      }
                      className={[
                        "month-cell",
                        plansByDate[date] ? "has-plan" : "is-empty",
                        date === today ||
                        (date === anchorDate && !selectionMode)
                          ? "is-current"
                          : "",
                        selected.has(date) ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={isPending}
                      onClick={(event) => activate(date, event)}
                      onContextMenu={(event) => event.preventDefault()}
                      onKeyDown={(event) => onGridKeyDown(event, date)}
                      onPointerCancel={cancelLongPress}
                      onPointerDown={() => beginLongPress(date)}
                      onPointerLeave={cancelLongPress}
                      onPointerUp={cancelLongPress}
                      ref={(node) => {
                        if (node) {
                          cellRefs.current.set(date, node);
                        } else {
                          cellRefs.current.delete(date);
                        }
                      }}
                      type="button"
                    >
                      <span className="month-cell-number">
                        {Number(date.slice(8, 10))}
                      </span>
                      {plansByDate[date] ? (
                        <span className="month-cell-count">
                          {plansByDate[date].stopCount}
                        </span>
                      ) : null}
                      {selected.has(date) ? (
                        <span aria-hidden="true" className="month-cell-check">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  </span>
                ),
              )}
            </div>
          ))}
        </div>

        <div className="month-legend">
          <span className="month-legend-item">
            <span aria-hidden="true" className="month-swatch has-plan" />
            {t("legendPlanned")}
          </span>
          <span className="month-legend-item">
            <span aria-hidden="true" className="month-swatch is-empty" />
            {t("legendEmpty")}
          </span>
        </div>
      </div>

      {selectedDates.length > 0 ? (
        <div className="panel month-action-panel">
          <div className="month-action-head">
            <h2>{t("selectedDays", { count: selectedDates.length })}</h2>
            <button
              className="month-action-cancel"
              onClick={clearSelection}
              type="button"
            >
              {tCommon("cancel")}
            </button>
          </div>

          <ul className="month-chip-list">
            {[...selectedDates].sort().map((date) => (
              <li className="month-chip" key={date}>
                {format.dateTime(dateToUtcNoon(date), {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </li>
            ))}
          </ul>

          <button
            aria-busy={isPending}
            aria-haspopup="dialog"
            className={`primary-button month-assign-all${isPending ? " is-pending" : ""}`}
            disabled={isPending || routeTemplates.length === 0}
            onClick={() => dialogRef.current?.showModal()}
            type="button"
          >
            {isPending ? (
              <PendingLabel label={t("assigningToAll")} />
            ) : (
              t("assignToAll")
            )}
          </button>

          <ConfirmActionButton
            action={copyLastWeekAction}
            cancelLabel={tCommon("cancel")}
            confirmLabel={t("weekCopyConfirm")}
            fieldName="weekStart"
            id={anchorWeekStart}
            pendingLabel={t("copyingWeek")}
            promptText={t("copyLastWeekAction")}
            renderTrigger={({ onClick, ref }) => (
              <button
                className="secondary-button month-copy-last-week"
                onClick={onClick}
                ref={ref}
                type="button"
              >
                {t("copyLastWeek")}
              </button>
            )}
            variantClassName="confirm-action-inline"
          />
        </div>
      ) : null}

      <dialog
        aria-labelledby="month-assign-dialog-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id="month-assign-dialog-title">{t("assignRouteDialogTitle")}</h2>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="visit-form compact modal-form">
          <ul className="route-card-list modal-admin-list">
            {routeTemplates.map((routeTemplate) => (
              <li key={routeTemplate.id}>
                <button
                  className="route-card route-card-button"
                  disabled={isPending}
                  onClick={() => assignToSelection(routeTemplate.id)}
                  type="button"
                >
                  <span className="route-card-icon" aria-hidden="true">
                    <RouteIcon />
                  </span>
                  <span className="route-card-body">
                    <h3>{routeTemplate.name}</h3>
                    <span className="route-card-meta">
                      <MapPinIcon />
                      {t("routeStopsCount", { count: routeTemplate.stopCount })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}

type MonthTranslator = ReturnType<typeof useTranslations<"field.planning">>;
type Formatter = ReturnType<typeof useFormatter>;

/**
 * The month split into calendar weeks — seven cells each, padded with nulls
 * before the 1st and after the last day. A `role="grid"` whose rows are real
 * weeks is what lets a screen reader move through the month the way the eye
 * does; one flat row of 31 cells under a seven-column header row would
 * describe a table that is not the one on screen.
 */
function monthRows(
  dates: string[],
  leadingBlanks: number,
): Array<{ key: string; cells: Array<string | null> }> {
  const cells: Array<string | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...dates,
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return Array.from({ length: cells.length / 7 }, (_, index) => {
    const rowCells = cells.slice(index * 7, index * 7 + 7);

    return {
      // Keyed by the row's first real date, so re-rendering a month never
      // reuses a row identity across a different month.
      key: rowCells.find((cell) => cell !== null) ?? `row-${index}`,
      cells: rowCells,
    };
  });
}

/** Monday-first weekday headers in the request locale. */
function weekdayLabels(format: Formatter): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    // 2024-01-01 was a Monday.
    format.dateTime(new Date(Date.UTC(2024, 0, 1 + index, 12)), {
      weekday: "short",
      timeZone: "UTC",
    }),
  );
}

/**
 * The cell's accessible name. A bare number plus a colour tells a screen
 * reader nothing about whether the day is planned, so the state is spelled
 * out here the way the week grid does it.
 */
function cellLabel(
  date: string,
  plans: MonthDayPlans | undefined,
  format: Formatter,
  t: MonthTranslator,
): string {
  const dayLabel = format.dateTime(dateToUtcNoon(date), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  if (!plans) {
    return t("dayCellEmptyAria", { day: dayLabel });
  }

  return t("dayCellPlannedAria", {
    day: dayLabel,
    routes: plans.routeNames.join(", "),
    count: plans.stopCount,
  });
}
