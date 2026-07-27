"use server";

import { redirect } from "next/navigation";

import { isAssortmentStatus } from "./assortment-status";
import {
  deleteLocationAssortment,
  deleteLocationPotential,
  upsertLocationAssortment,
  upsertLocationPotential,
} from "./api-client";
import {
  getFormBoolean,
  getFormOptionalNumber,
  getFormOptionalString,
  getFormString,
} from "./form";

// Shared by the field and admin location detail screens' potential/
// assortment panels — the only two places these four actions differ is the
// zone-specific base path and (field only) the `from` origin that needs to
// survive the redirect, so the back control still points at the screen the
// rep actually came from once the panel has saved. A Server Action
// can only close over serializable data and other Server Actions, not a
// plain helper function, so each page passes its own basePath/locationId/
// extraParams into these via Function.prototype.bind rather than these
// being called directly — bind() on an exported "use server" function is
// the supported way to give it extra pre-filled arguments.
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

export async function upsertLocationPotentialAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const productCategoryId = getFormString(formData, "productCategoryId").trim();

  if (!productCategoryId) {
    redirect(
      buildRedirectUrl(basePath, extraParams, [["error", "locationInsights"]]),
    );
  }

  const result = await upsertLocationPotential(locationId, productCategoryId, {
    potentialDate: getFormOptionalString(formData, "potentialDate"),
    potentialAmount: getFormOptionalNumber(formData, "potentialAmount"),
    planMonth1: getFormOptionalNumber(formData, "planMonth1"),
    planMonth2: getFormOptionalNumber(formData, "planMonth2"),
    planMonth3: getFormOptionalNumber(formData, "planMonth3"),
    comment: getFormOptionalString(formData, "comment"),
  });

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "updated"]
        : ["error", "locationInsights"],
    ]),
  );
}

export async function deleteLocationPotentialAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const productCategoryId = getFormString(formData, "productCategoryId").trim();
  const result = productCategoryId
    ? await deleteLocationPotential(locationId, productCategoryId)
    : { ok: false as const, status: 0, message: "Missing category" };

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "deleted"]
        : ["error", "locationInsights"],
    ]),
  );
}

export async function upsertLocationAssortmentAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const productId = getFormString(formData, "productId").trim();
  const statusValue = getFormString(formData, "status");
  // A malformed/tampered status falls back to the backend's own default
  // (in_stock) rather than casting it on trust — the <select> options never
  // actually produce anything outside ASSORTMENT_STATUSES.
  const status = isAssortmentStatus(statusValue) ? statusValue : undefined;

  if (!productId) {
    redirect(
      buildRedirectUrl(basePath, extraParams, [["error", "locationInsights"]]),
    );
  }

  const result = await upsertLocationAssortment(locationId, productId, {
    shouldBeListed: getFormBoolean(formData, "shouldBeListed"),
    status,
    lastStock: getFormOptionalNumber(formData, "lastStock"),
    lastOrder: getFormOptionalNumber(formData, "lastOrder"),
    lastSale: getFormOptionalNumber(formData, "lastSale"),
    lastCheckedAt: getFormOptionalString(formData, "lastCheckedAt"),
    comment: getFormOptionalString(formData, "comment"),
  });

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "updated"]
        : ["error", "locationInsights"],
    ]),
  );
}

export async function deleteLocationAssortmentAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const productId = getFormString(formData, "productId").trim();
  const result = productId
    ? await deleteLocationAssortment(locationId, productId)
    : { ok: false as const, status: 0, message: "Missing product" };

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "deleted"]
        : ["error", "locationInsights"],
    ]),
  );
}
