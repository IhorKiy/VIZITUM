import { redirect } from "next/navigation";

import { getCurrentSession } from "../../lib/api-client";
import { resolveZoneLanding, zoneHomePath } from "../../lib/navigation";

type TenantHomePageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function TenantHomePage({ params }: TenantHomePageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    // Preserves the pre-existing behavior for anonymous visitors: land on
    // /field, which renders its own sign-in prompt (and demo data when
    // ENABLE_DEMO_FALLBACK is on) rather than a hard login redirect.
    redirect(`/${tenantSlug}/field`);
  }

  const landing = resolveZoneLanding(
    sessionResult.data.permissions,
    sessionResult.data.productsEnabled,
    sessionResult.data.user.lastSelectedZone,
    sessionResult.data.pilotActive,
  );

  if (landing.kind === "zone") {
    redirect(`/${tenantSlug}${zoneHomePath(landing.zone)}`);
  }

  if (landing.kind === "choose") {
    redirect(`/${tenantSlug}/choose-zone`);
  }

  redirect(`/${tenantSlug}/no-access`);
}
