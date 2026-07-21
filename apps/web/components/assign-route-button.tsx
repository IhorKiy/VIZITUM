"use client";

import { useRef, useTransition } from "react";
import { useTranslations } from "next-intl";

import { MapPinIcon, RouteIcon } from "./icons";
import type { RouteTemplate } from "../lib/api-client";

type AssignRouteButtonProps = {
  assignAction: (formData: FormData) => Promise<void>;
  hasExistingPlans: boolean;
  planDate: string;
  routeTemplates: RouteTemplate[];
};

export function AssignRouteButton({
  assignAction,
  hasExistingPlans,
  planDate,
  routeTemplates,
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
      <button
        aria-haspopup="dialog"
        className="dashed-action-button"
        disabled={isPending}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <span aria-hidden="true">+</span>{" "}
        {hasExistingPlans ? t("addAnotherRoute") : t("assignRoute")}
      </button>

      <dialog
        aria-labelledby="assign-route-dialog-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <h2 id="assign-route-dialog-title">{t("assignRouteDialogTitle")}</h2>
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
