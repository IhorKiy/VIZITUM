import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../components/app-shell";
import { BackLink } from "../../../../../../components/back-link";
import { PackageIcon } from "../../../../../../components/icons";
import { LocationAssignmentPill } from "../../../../../../components/location-assignment-pill";
import { LocationAssortmentPanel } from "../../../../../../components/location-assortment-panel";
import { resolveBackTarget } from "../../../../../../lib/back-navigation";
import {
  getCurrentSession,
  getLocation,
  listLocationAssortment,
} from "../../../../../../lib/api-client";

type LocationAssortmentPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    from?: string;
  }>;
};

export default async function LocationAssortmentPage({
  params,
  searchParams,
}: LocationAssortmentPageProps) {
  const { tenantSlug, locationId } = await params;
  const { from } = await searchParams;
  const [tBack, tLocationInsights] = await Promise.all([
    getTranslations("common.back"),
    getTranslations("common.locationInsights"),
  ]);

  // Nothing on this screen writes any more, so the opener is only needed for
  // the back link — no action redirect has to carry it forward.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field/locations/${locationId}`,
    labelKey: "location",
  });

  const [sessionResult, locationResult] = await Promise.all([
    getCurrentSession(),
    getLocation(locationId),
  ]);

  if (!sessionResult.ok) {
    redirect(`/${tenantSlug}/login`);
  }
  if (!locationResult.ok) {
    redirect(`/${tenantSlug}/field`);
  }
  // Insights aren't available for a products-disabled tenant or an archived
  // location — send the rep back to the location card rather than showing an
  // empty, unusable page.
  if (!sessionResult.data.productsEnabled || locationResult.data.archived) {
    redirect(backTarget.href);
  }

  const locationName = locationResult.data.name;
  const locationAssignments = locationResult.data.assignments;
  const currentUserId = sessionResult.data.user.id;

  const assortmentResult = await listLocationAssortment(locationId);

  const assortmentRows = assortmentResult.ok ? assortmentResult.data.items : [];
  const assortmentCoverage = assortmentResult.ok
    ? {
        pct: assortmentResult.data.coveragePct,
        required: assortmentResult.data.requiredCount,
        inStock: assortmentResult.data.inStockCount,
        checked: assortmentResult.data.checkedCount,
      }
    : { pct: 0, required: 0, inStock: 0, checked: 0 };

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      <div className="location-detail-sections">
        <BackLink
          href={backTarget.href}
          inline
          label={tBack(backTarget.labelKey)}
        />
        <div className="panel location-header">
          <div className="location-header-summary">
            <div className="location-header-identity">
              <span className="location-header-icon-lead" aria-hidden="true">
                <PackageIcon size={44} />
              </span>
              <h1 className="location-header-title">
                {tLocationInsights("assortmentTitle")}
              </h1>
              <p className="location-header-address">{locationName}</p>
              <p className="location-header-meta">
                {tLocationInsights("assortmentCount", {
                  count: assortmentRows.length,
                })}
              </p>
              <LocationAssignmentPill
                assignments={locationAssignments}
                currentUserId={currentUserId}
              />
            </div>
          </div>
        </div>

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-icon" aria-hidden="true">
              <PackageIcon size={20} />
            </span>
          </div>
          {/* Read-only by zone, not by permission: the assortment is the
              standard a manager sets on /manager/locations/:id, and the field
              screen shows what this outlet must carry. Hardcoded rather than
              passed from the response's canManage, so a user who also holds
              team_manager doesn't get an editor while working as a rep — the
              same reasoning the admin detail screen uses. */}
          <LocationAssortmentPanel
            canManage={false}
            checkedCount={assortmentCoverage.checked}
            coveragePct={assortmentCoverage.pct}
            inStockCount={assortmentCoverage.inStock}
            locationName={locationName}
            requiredCount={assortmentCoverage.required}
            rows={assortmentRows}
            variant="cards"
          />
        </section>
      </div>
    </AppShell>
  );
}
