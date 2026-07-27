"use server";

import { redirect } from "next/navigation";

import { cancelVisit } from "./api-client";
import { getFormOptionalString, getFormString } from "./form";
import { isVisitCancellationReason } from "./visit-cancellation";

// Shared by the field visit page and the location card. A Server Action can
// only close over serializable data, so each caller pre-fills its own
// basePath/visitId/extraParams via Function.prototype.bind (same pattern as
// location-insights-actions.ts). Both callers land on the location card
// afterwards; extraParams carries `from` so the card's back control still
// points at the screen the rep originally came from — but deliberately NOT
// routePlanId/routeItemId: cancelling flips the route stop to `skipped` and
// the cancelled visit keeps the stop's unique visit slot, so the card must
// come back in its plain "start an unlinked visit" state rather than offer
// to reuse a slot that would violate the visits.routeItemId unique key.
function buildRedirectUrl(
  basePath: string,
  extraParams: [string, string][],
  statusParams: [string, string][],
): string {
  const params = new URLSearchParams(extraParams);
  for (const [key, value] of statusParams) {
    params.set(key, value);
  }
  return `${basePath}?${params.toString()}`;
}

export async function cancelVisitAction(
  basePath: string,
  visitId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const reason = getFormString(formData, "reason").trim();

  if (!isVisitCancellationReason(reason)) {
    redirect(
      buildRedirectUrl(basePath, extraParams, [["error", "cancelVisit"]]),
    );
  }

  const comment = getFormOptionalString(formData, "comment");
  const result = await cancelVisit(visitId, {
    reason,
    ...(comment ? { comment } : {}),
  });

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok ? ["cancelled", "1"] : ["error", "cancelVisit"],
    ]),
  );
}
