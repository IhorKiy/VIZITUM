import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "../../../lib/api-client";
import { resolveZoneLanding, zoneHomePath } from "../../../lib/navigation";
import { resolveTenantBranding } from "../../../lib/tenant-branding";

type NoAccessPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function NoAccessPage({ params }: NoAccessPageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }

  // Defensive re-check: if roles changed since the redirect that sent the
  // user here, don't show a stale "no access" state.
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

  // Cache hit on the tenant layout's branding fetch; here for the name only.
  const [t, tCommon, branding] = await Promise.all([
    getTranslations("common.zone.noAccess"),
    getTranslations("common"),
    resolveTenantBranding(tenantSlug),
  ]);

  return (
    <main className="login-surface">
      <section aria-labelledby="no-access-title" className="login-panel">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{branding.name}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 id="no-access-title">{t("title")}</h1>
          <p className="login-copy">{t("body")}</p>
        </div>
      </section>
    </main>
  );
}
