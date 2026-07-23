"use server";

import { redirect } from "next/navigation";

import {
  createLocationContact,
  deleteLocationContact,
  updateLocationContact,
  updateLocationNotes,
} from "./api-client";
import { getFormOptionalString, getFormString } from "./form";

// Shared by the field location detail screen's note and contacts cards — same
// basePath/locationId/extraParams .bind() convention as
// location-insights-actions.ts (see that file's comment for why: a Server
// Action can only close over serializable data and other Server Actions, not
// a plain helper function). Reuses that same file's "locationInsights"
// updated/deleted status param rather than a parallel one — Potential and
// Assortment already share one status channel for two cards on this page;
// this extends it to the note and contacts cards instead of adding a second
// channel.
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

export async function upsertLocationNotesAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const result = await updateLocationNotes(locationId, {
    notes: getFormOptionalString(formData, "notes"),
  });

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "updated"]
        : ["error", "locationInsights"],
    ]),
  );
}

export async function upsertLocationContactAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const contactId = getFormOptionalString(formData, "contactId");
  const name = getFormString(formData, "name").trim();

  if (!name) {
    redirect(
      buildRedirectUrl(basePath, extraParams, [["error", "locationInsights"]]),
    );
  }

  const input = {
    name,
    roleTitle: getFormOptionalString(formData, "roleTitle"),
    phone: getFormOptionalString(formData, "phone"),
    email: getFormOptionalString(formData, "email"),
    notes: getFormOptionalString(formData, "notes"),
  };

  const result = contactId
    ? await updateLocationContact(locationId, contactId, input)
    : await createLocationContact(locationId, input);

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "updated"]
        : ["error", "locationInsights"],
    ]),
  );
}

export async function deleteLocationContactAction(
  basePath: string,
  locationId: string,
  extraParams: [string, string][],
  formData: FormData,
): Promise<void> {
  const contactId = getFormString(formData, "contactId").trim();
  const result = contactId
    ? await deleteLocationContact(locationId, contactId)
    : { ok: false as const, status: 0, message: "Missing contact" };

  redirect(
    buildRedirectUrl(basePath, extraParams, [
      result.ok
        ? ["locationInsights", "deleted"]
        : ["error", "locationInsights"],
    ]),
  );
}
