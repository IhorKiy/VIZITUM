import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentSession } from "../../../lib/api-client";
import {
  normalizeTenantName,
  resolveZoneLanding,
  zoneHomePath,
} from "../../../lib/navigation";
import { selectZoneAction } from "../../../lib/zone-actions";

type ChooseZonePageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function ChooseZonePage({ params }: ChooseZonePageProps) {
  const { tenantSlug } = await params;
  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }

  // Recomputed defensively (permissions/stored choice may have changed
  // since whatever redirect sent the user here, or this URL was
  // bookmarked) rather than trusted from the caller.
  const landing = resolveZoneLanding(
    sessionResult.data.permissions,
    sessionResult.data.productsEnabled,
    sessionResult.data.user.lastSelectedZone,
    sessionResult.data.pilotActive,
  );

  if (landing.kind === "zone") {
    redirect(`/${tenantSlug}${zoneHomePath(landing.zone)}`);
  }

  if (landing.kind === "no-access") {
    redirect(`/${tenantSlug}/no-access`);
  }

  const [tChooser, tZoneNames, tCommon] = await Promise.all([
    getTranslations("common.zone.chooser"),
    getTranslations("common.zone.names"),
    getTranslations("common"),
  ]);

  return (
    <main className="login-surface">
      <section aria-labelledby="choose-zone-title" className="login-panel">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{normalizeTenantName(tenantSlug)}</p>
          </div>
        </div>

        <div>
          <p className="eyebrow">{tChooser("eyebrow")}</p>
          <h1 id="choose-zone-title">{tChooser("title")}</h1>
          <p className="login-copy">{tChooser("copy")}</p>
        </div>

        <div
          aria-label={tChooser("listAriaLabel")}
          className="zone-choice-list"
        >
          {landing.zones.map((zone) => (
            <form action={selectZoneAction} key={zone}>
              <input name="tenantSlug" type="hidden" value={tenantSlug} />
              <input name="zone" type="hidden" value={zone} />
              <button className="zone-choice-link" type="submit">
                {tZoneNames(zone)}
              </button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
