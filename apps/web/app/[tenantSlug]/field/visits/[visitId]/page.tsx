import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { BackLink } from "../../../../../components/back-link";
import { CancelVisitModal } from "../../../../../components/cancel-visit-modal";
import { ConfirmedFieldReportSummary } from "../../../../../components/confirmed-field-report-summary";
import { FieldVisitReportForm } from "../../../../../components/field-visit-report-form";
import { PendingVisitReport } from "../../../../../components/pending-visit-report";
import {
  createStorageObjectDownloadUrl,
  getCurrentSession,
  getFieldReportVoiceHint,
  getVisit,
  getVisitReport,
  listAllProducts,
  listLocationAssortment,
} from "../../../../../lib/api-client";
import { resolveBackTarget } from "../../../../../lib/back-navigation";
import { cancelVisitAction } from "../../../../../lib/cancel-visit-actions";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";
import { formatCancellationReason } from "../../../../../lib/visit-cancellation";

type VisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
  searchParams: Promise<{
    demoName?: string;
    demoAddress?: string;
    demoLocationId?: string;
    from?: string;
  }>;
};

export default async function VisitDetailPage({
  params,
  searchParams,
}: VisitDetailPageProps) {
  const { tenantSlug, visitId } = await params;
  const { demoName, demoAddress, demoLocationId, from } = await searchParams;
  const [t, tBack, tField, tCommon] = await Promise.all([
    getTranslations("field.visit"),
    getTranslations("common.back"),
    getTranslations("field"),
    getTranslations("common"),
  ]);

  const [sessionResult, visitResult] = await Promise.all([
    getCurrentSession(),
    getVisit(visitId),
  ]);

  const demoFallbackEnabled = isDemoFallbackEnabled();
  const isDemoVisit =
    !sessionResult.ok &&
    demoFallbackEnabled &&
    visitId.startsWith("demo-visit-");

  if (!sessionResult.ok && !isDemoVisit) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("signedOutTitle")}</h1>
            <p>{t("signedOutBody")}</p>
          </div>
          <div
            className="toolbar"
            aria-label={tCommon("notice.sessionActions")}
          >
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>
      </AppShell>
    );
  }

  if (isDemoVisit) {
    const demoBackTarget = resolveBackTarget(
      tenantSlug,
      from,
      demoLocationId
        ? {
            href: `/${tenantSlug}/field/locations/${demoLocationId}`,
            labelKey: "location",
          }
        : { href: `/${tenantSlug}/field`, labelKey: "home" },
    );

    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <BackLink
          href={demoBackTarget.href}
          label={tBack(demoBackTarget.labelKey)}
        />
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{demoName ?? t("demoStatus")}</h1>
            <p>{demoAddress ?? ""}</p>
          </div>
        </header>
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.demoMode")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{t("demoBody")}</p>
            <p>{t("demoNext")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  if (!visitResult.ok) {
    // The server not knowing this id no longer only means a bad link — it is
    // also what a visit started with no signal looks like until it syncs.
    // PendingVisitReport checks the on-device start queue for this exact id
    // and falls back to the same not-found panel this branch always rendered
    // when nothing local matches either.
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <PendingVisitReport
          from={from}
          notFoundMessage={visitResult.message}
          tenantSlug={tenantSlug}
          userId={sessionResult.ok ? sessionResult.data.user.id : ""}
          visitId={visitId}
        />
      </AppShell>
    );
  }

  const visit = visitResult.data;
  // This report is opened from the location card, from the field history and
  // from a location's own visit history. Returning to the location card
  // regardless dropped anyone who came from a history list into a screen they
  // never passed through, losing their filters with it.
  const backTarget = resolveBackTarget(tenantSlug, from, {
    href: `/${tenantSlug}/field/locations/${visit.locationId}`,
    labelKey: "location",
  });
  const isLocked = visit.status === "completed" || visit.status === "cancelled";
  const locationAddress = [visit.location.addressLine, visit.location.city]
    .filter(Boolean)
    .join(", ");

  const [productsResult, reportResult, voiceHintResult, assortmentResult] =
    await Promise.all([
      isLocked ? Promise.resolve(null) : listAllProducts(),
      isLocked ? getVisitReport(visitId) : Promise.resolve(null),
      isLocked ? Promise.resolve(null) : getFieldReportVoiceHint(),
      isLocked
        ? Promise.resolve(null)
        : listLocationAssortment(visit.locationId),
    ]);

  // The shelf-check chips are the products this outlet is supposed to carry,
  // so the rep taps what's missing instead of searching the whole catalog.
  // The full matrix is passed, not a first-N slice: confirming the check now
  // marks every unmarked required product as present, so a truncated list
  // would silently vouch for shelves the rep was never shown. The form
  // collapses long lists behind a "show all" instead.
  // A failed assortment read is not worth failing the report screen over —
  // the catalog search inside the panel stays as the fallback.
  const shelfProducts =
    assortmentResult?.ok === true
      ? assortmentResult.data.items
          .filter((item) => item.shouldBeListed)
          .map((item) => item.product)
      : [];
  // The problem photo lives in storage, so the read-only summary needs a
  // freshly presigned link. Failing to sign one must not take the whole report
  // view down — the summary falls back to naming the attachment.
  const problemPhotoObjectId = reportResult?.ok
    ? problemPhotoObjectIdFromReport(reportResult.data.confirmedData)
    : null;
  const problemPhotoResult = problemPhotoObjectId
    ? await createStorageObjectDownloadUrl(problemPhotoObjectId)
    : null;

  // A cancelled visit legitimately never gets a confirmed report — that's
  // not a load failure, so it gets a neutral notice instead of the danger
  // one a completed visit missing its report (a real error) still shows.
  const isCancelledWithoutReport =
    visit.status === "cancelled" &&
    reportResult !== null &&
    !reportResult.ok &&
    reportResult.code === "REPORT_NOT_FOUND";

  // Cancelling is the rep's own affordance on their own unfinished visit; the
  // post-cancel redirect lands on the location card, whose `from` this page
  // forwards so the card's back control keeps pointing at the original opener.
  const canCancel =
    !isLocked &&
    sessionResult.ok &&
    sessionResult.data.user.id === visit.representativeUserId &&
    sessionResult.data.permissions.includes("visits.cancel_own");
  const cancelAction = cancelVisitAction.bind(
    null,
    `/${tenantSlug}/field/locations/${visit.locationId}`,
    visitId,
    from ? [["from", from]] : [],
  );

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {isLocked ? (
        <>
          <BackLink href={backTarget.href} label={tBack(backTarget.labelKey)} />
          <header className="page-header">
            <div>
              <p className="eyebrow">{t("eyebrow")}</p>
              <h1>{visit.location.name}</h1>
              <p>{locationAddress}</p>
            </div>
          </header>
        </>
      ) : (
        <header className="visit-report-header">
          <BackLink
            href={backTarget.href}
            inline
            label={tBack(backTarget.labelKey)}
          />
          <div>
            <h1>{visit.location.name}</h1>
            <p>{locationAddress}</p>
          </div>
        </header>
      )}

      {isLocked ? (
        reportResult?.ok ? (
          <article className="visit-card">
            <ConfirmedFieldReportSummary
              confirmedAt={reportResult.data.confirmedAt}
              confirmedData={reportResult.data.confirmedData}
              problemPhotoUrl={
                problemPhotoResult?.ok ? problemPhotoResult.data.url : null
              }
            />
          </article>
        ) : isCancelledWithoutReport ? (
          <section
            className="notice-panel"
            aria-label={t("cancelledNoReportAria")}
          >
            <div>
              <p className="eyebrow">{t("cancelledNoReportEyebrow")}</p>
              <h2>{t("cancelledNoReportTitle")}</h2>
              <p>{t("cancelledNoReportBody")}</p>
              {visit.cancellationReason ? (
                <p>
                  {t("cancelledReasonLabel")}
                  {": "}
                  {formatCancellationReason(tCommon, visit.cancellationReason)}
                  {visit.cancellationComment
                    ? ` — ${visit.cancellationComment}`
                    : null}
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <section
            className="notice-panel danger"
            aria-label={t("reportErrorAria")}
          >
            <div>
              <p className="eyebrow">{t("reportErrorEyebrow")}</p>
              <h2>{t("reportErrorTitle")}</h2>
              <p>{reportResult?.message}</p>
            </div>
          </section>
        )
      ) : (
        <>
          <FieldVisitReportForm
            products={productsResult?.ok ? productsResult.data : []}
            shelfProducts={shelfProducts}
            tenantSlug={tenantSlug}
            // Keys the on-device draft. Only reachable here because the
            // signed-out branch above already returned.
            userId={sessionResult.ok ? sessionResult.data.user.id : ""}
            visitId={visitId}
            voiceHint={
              voiceHintResult?.ok ? voiceHintResult.data.voiceHint : null
            }
          />
          {canCancel ? (
            <div className="visit-cancel-action">
              <CancelVisitModal
                action={cancelAction}
                locationName={visit.location.name}
                tenantSlug={tenantSlug}
                userId={visit.representativeUserId}
                visitId={visitId}
              />
            </div>
          ) : null}
        </>
      )}
    </AppShell>
  );
}

function problemPhotoObjectIdFromReport(confirmedData: unknown): string | null {
  if (typeof confirmedData !== "object" || confirmedData === null) {
    return null;
  }

  const fieldReport = (confirmedData as { fieldReport?: unknown }).fieldReport;

  if (typeof fieldReport !== "object" || fieldReport === null) {
    return null;
  }

  const problem = (fieldReport as { problem?: unknown }).problem;

  if (typeof problem !== "object" || problem === null) {
    return null;
  }

  const photoObjectId = (problem as { photoObjectId?: unknown }).photoObjectId;

  return typeof photoObjectId === "string" && photoObjectId
    ? photoObjectId
    : null;
}
