import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PendingSubmitButton } from "../../../components/pending-submit-button";
import { getCurrentSession } from "../../../lib/api-client";
import { resolveZoneLanding, zoneHomePath } from "../../../lib/navigation";
import { resolveTenantBranding } from "../../../lib/tenant-branding";
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

  // The tenant layout already resolved branding for this request, so this is a
  // cache hit, not a second round-trip — it is here only for the workspace name.
  const [tChooser, tZoneNames, tCommon, branding] = await Promise.all([
    getTranslations("common.zone.chooser"),
    getTranslations("common.zone.names"),
    getTranslations("common"),
    resolveTenantBranding(tenantSlug),
  ]);

  return (
    <main className="login-surface">
      <section aria-labelledby="choose-zone-title" className="login-panel">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <p className="brand-name">{tCommon("appName")}</p>
            <p className="tenant-name">{branding.name}</p>
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
              {/* The chosen zone keeps its name while it loads — this is the
                  screen right after signing in, and a row that swapped its
                  label for "Saving..." would leave the reader unsure which
                  of the zones they actually picked. */}
              <PendingSubmitButton
                className="zone-choice-link"
                pendingLabel={tZoneNames(zone)}
              >
                {tZoneNames(zone)}
              </PendingSubmitButton>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
