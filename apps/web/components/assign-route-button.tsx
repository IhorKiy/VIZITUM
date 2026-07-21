"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import { MapPinIcon, RouteIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";
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

  return (
    <>
      <button
        className="dashed-action-button"
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
                {/* Own form per template (not one shared form with a
                    JS-set hidden field) so PendingSubmitButton's
                    useFormStatus() tracks that row's own pending state. */}
                <form
                  action={assignAction}
                  onSubmit={() => dialogRef.current?.close()}
                >
                  <input name="planDate" type="hidden" value={planDate} />
                  <input
                    name="routeTemplateId"
                    type="hidden"
                    value={routeTemplate.id}
                  />
                  <PendingSubmitButton
                    className="route-card route-card-button"
                    pendingLabel={t("assigningRoute")}
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
                  </PendingSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
