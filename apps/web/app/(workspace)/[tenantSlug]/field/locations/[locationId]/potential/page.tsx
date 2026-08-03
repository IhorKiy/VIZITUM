import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../../../components/app-shell";
import { BackLink } from "../../../../../../../components/back-link";
import { DismissableNotice } from "../../../../../../../components/dismissable-notice";
import { BanknoteIcon } from "../../../../../../../components/icons";
import { LocationAssignmentPill } from "../../../../../../../components/location-assignment-pill";
import { LocationPotentialModal } from "../../../../../../../components/location-potential-modal";
import { LocationPotentialPanel } from "../../../../../../../components/location-potential-panel";
import { resolveBackTarget } from "../../../../../../../lib/back-navigation";
import { resolveLocationKeeper } from "../../../../../../../lib/location-keeper";
import {
  getCurrentSession,
  getLocation,
  listLocationPotential,
  listProductCategories,
} from "../../../../../../../lib/api-client";
import {
  deleteLocationPotentialAction,
  upsertLocationPotentialAction,
} from "../../../../../../../lib/location-insights-actions";

type LocationPotentialPageProps = {
  params: Promise<{ tenantSlug: string; locationId: string }>;
  searchParams: Promise<{
    from?: string;
    error?: string;
    locationInsights?: string;
  }>;
};

export default async function LocationPotentialPage({
  params,
  searchParams,
}: LocationPotentialPageProps) {
  const { tenantSlug, locationId } = await params;
  const { from, error, locationInsights } = await searchParams;
  const [t, tBack, tLocationInsights] = await Promise.all([
    getTranslations("field"),
    getTranslations("common.back"),
    getTranslations("common.locationInsights"),
  ]);

  // Stay on this page after add/edit/delete (basePath = the potential page),
  // carrying the opener so the back link still returns to the location card in
  // the state it was left — same route stop, same screen behind it. Shared
  // with the location detail screen via lib/location-insights-actions.ts.
  const basePath = `/${tenantSlug}/field/locations/${locationId}/potential`;
  const extraParams: [string, string][] = from ? [["from", from]] : [];
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field/locations/${locationId}`,
    labelKey: "location",
  });

  const upsertPotentialAction = upsertLocationPotentialAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );
  const deletePotentialAction = deleteLocationPotentialAction.bind(
    null,
    basePath,
    locationId,
    extraParams,
  );

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
  const keeper = resolveLocationKeeper(
    locationResult.data.assignments,
    sessionResult.data.user.id,
  );

  const [potentialResult, categoriesResult] = await Promise.all([
    listLocationPotential(locationId),
    listProductCategories(),
  ]);

  const potentialRows = potentialResult.ok ? potentialResult.data.items : [];
  const canManagePotential = potentialResult.ok
    ? potentialResult.data.canManage
    : false;
  const availableCategories = (
    categoriesResult.ok ? categoriesResult.data : []
  ).filter(
    (category) =>
      !potentialRows.some((row) => row.productCategoryId === category.id),
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {error === "locationInsights" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("errorAria")}
          body={tLocationInsights("errorBody")}
          clearParams={["error"]}
          eyebrow={t("flowEyebrow")}
          title={tLocationInsights("errorTitle")}
          tone="danger"
        />
      ) : null}

      {locationInsights === "updated" || locationInsights === "deleted" ? (
        <DismissableNotice
          ariaLabel={tLocationInsights("savedAria")}
          clearParams={["locationInsights"]}
          compact
          title={tLocationInsights("savedTitle")}
          tone="success"
        />
      ) : null}

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
                <BanknoteIcon size={44} />
              </span>
              <h1 className="location-header-title">
                {tLocationInsights("potentialTitle")}
              </h1>
              <p className="location-header-address">{locationName}</p>
              <p className="location-header-meta">
                {tLocationInsights("potentialCount", {
                  count: potentialRows.length,
                })}
              </p>
              <LocationAssignmentPill keeper={keeper} />
            </div>
          </div>
        </div>

        <section className="panel location-feature">
          <div className="location-feature-page-head">
            <span className="location-feature-icon" aria-hidden="true">
              <BanknoteIcon size={20} />
            </span>
            <LocationPotentialModal
              action={upsertPotentialAction}
              availableCategories={availableCategories}
              canManage={canManagePotential}
              locationName={locationName}
              mode="add"
            />
          </div>
          <LocationPotentialPanel
            availableCategories={availableCategories}
            canManage={canManagePotential}
            deleteAction={deletePotentialAction}
            keeper={keeper}
            locationName={locationName}
            rows={potentialRows}
            upsertAction={upsertPotentialAction}
            variant="cards"
          />
        </section>
      </div>
    </AppShell>
  );
}
