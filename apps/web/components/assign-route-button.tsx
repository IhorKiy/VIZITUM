"use client";

import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";

import { MapPinIcon, RouteIcon } from "./icons";
import type { RouteTemplate } from "../lib/api-client";

/**
 * Where the trigger sits, not what it does:
 * - `day` — an unplanned day in the week list. The whole row *is* the button,
 *   dashed, carrying its own weekday/date column; assigning is the primary
 *   action of that row, so nothing smaller would be a fair target.
 * - `inline` — a compact "add another" under the routes a planned day already
 *   holds.
 */
type AssignRouteVariant = "day" | "inline";

type AssignRouteButtonProps = {
  assignAction: (formData: FormData) => Promise<void>;
  planDate: string;
  routeTemplates: RouteTemplate[];
  variant: AssignRouteVariant;
  /** `day` variant only: the row's own left column and today marker. */
  dayNumber?: number;
  weekdayLabel?: string;
  isToday?: boolean;
};

export function AssignRouteButton({
  assignAction,
  planDate,
  routeTemplates,
  variant,
  dayNumber,
  weekdayLabel,
  isToday = false,
}: AssignRouteButtonProps) {
  const t = useTranslations("field.planning");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Shared across the trigger and every row (rather than per-row form
  // pending state) so re-opening the dialog and picking again — the same
  // template or another one — is blocked for the whole window between
  // closing the dialog on submit and the resulting redirect landing, not
  // just while an individual row's own request is in flight.
  const [isPending, startTransition] = useTransition();
  // Unique per day: several of these render at once in the week list, and a
  // repeated id would point every dialog's label at the first one's heading.
  const dialogTitleId = `assign-route-dialog-title-${planDate}`;

  function assign(routeTemplateId: string) {
    const formData = new FormData();
    formData.set("planDate", planDate);
    formData.set("routeTemplateId", routeTemplateId);
    dialogRef.current?.close();
    startTransition(async () => {
      await assignAction(formData);
    });
  }

  return (
    <>
      {variant === "day" ? (
        <button
          aria-haspopup="dialog"
          className={`week-day-row is-empty${isToday ? " is-today" : ""}`}
          disabled={isPending}
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          <span className="week-day-col">
            <span className="week-day-weekday">{weekdayLabel}</span>
            <span className="week-day-number">{dayNumber}</span>
          </span>
          <span className="week-day-divider" aria-hidden="true" />
          <span className="week-day-body">
            <span className="week-day-assign">
              <span aria-hidden="true">+</span> {t("assignRoute")}
            </span>
            {isToday ? (
              <span className="week-day-today-badge">{t("todayBadge")}</span>
            ) : null}
          </span>
        </button>
      ) : (
        <button
          aria-haspopup="dialog"
          className="week-day-add"
          disabled={isPending}
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          <span aria-hidden="true">+</span> {t("addAnotherRoute")}
        </button>
      )}

      <dialog
        aria-labelledby={dialogTitleId}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id={dialogTitleId}>{t("assignRouteDialogTitle")}</h2>
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
                  onClick={() => assign(routeTemplate.id)}
                  type="button"
                >
                  <span className="route-card-icon" aria-hidden="true">
                    <RouteIcon />
                  </span>
                  <span className="route-card-body">
                    <h3>{routeTemplate.name}</h3>
                    <span className="route-card-meta">
                      <MapPinIcon />
                      {t("routeStopsCount", {
                        count: routeTemplate.items.length,
                      })}
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
