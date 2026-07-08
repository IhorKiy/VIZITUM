"use server";

import { redirect } from "next/navigation";

import { switchZone } from "./api-client";
import { isZone, zoneHomePath } from "./navigation";

// Shared by the zone chooser and the AppShell switcher so a picked zone is
// always persisted (POST /auth/zone) the same way, from either entry point.
export async function selectZoneAction(formData: FormData): Promise<void> {
  const tenantSlug = String(formData.get("tenantSlug") ?? "");
  const zone = String(formData.get("zone") ?? "");

  if (!tenantSlug || !isZone(zone)) {
    return;
  }

  // Best-effort persistence: even if this rejects (e.g. stale permissions),
  // still send the user on — the AppShell guard on the landing page
  // independently re-checks availability and corrects if needed.
  await switchZone(zone);

  redirect(`/${tenantSlug}${zoneHomePath(zone)}`);
}
