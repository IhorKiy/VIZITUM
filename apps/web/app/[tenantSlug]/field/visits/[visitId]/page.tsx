import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { BackLink } from "../../../../../components/back-link";
import { ConfirmedFieldReportSummary } from "../../../../../components/confirmed-field-report-summary";
import { FieldVisitReportForm } from "../../../../../components/field-visit-report-form";
import {
  createStorageObjectDownloadUrl,
  getCurrentSession,
  getFieldReportVoiceHint,
  getVisit,
  getVisitReport,
  listAllProducts,
  listLocationAssortment,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";

// Enough to cover an outlet's key SKUs without turning the panel back into
// the shelf audit this screen exists to avoid.
const SHELF_CHIP_LIMIT = 8;

type VisitDetailPageProps = {
  params: Promise<{ tenantSlug: string; visitId: string }>;
  searchParams: Promise<{
    demoName?: string;
    demoAddress?: string;
    demoLocationId?: string;
  }>;
};

export default async function VisitDetailPage({
  params,
  searchParams,
}: VisitDetailPageProps) {
  const { tenantSlug, visitId } = await params;
  const { demoName, demoAddress } = await searchParams;
  const [t, tField, tCommon] = await Promise.all([
    getTranslations("field.visit"),
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
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <BackLink href={`/${tenantSlug}/field`} label={tField("backToRoute")} />
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
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field">
        <BackLink href={`/${tenantSlug}/field`} label={tField("backToRoute")} />
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("notFoundTitle")}</h1>
          </div>
        </header>
        <section
          className="notice-panel danger"
          aria-label={t("visitErrorAria")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("loadErrorTitle")}</h2>
            <p>{visitResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const visit = visitResult.data;
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
  // A failed assortment read is not worth failing the report screen over —
  // the catalog search inside the panel stays as the fallback.
  const shelfProducts =
    assortmentResult?.ok === true
      ? assortmentResult.data.items
          .filter((item) => item.shouldBeListed)
          .slice(0, SHELF_CHIP_LIMIT)
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

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field">
      {isLocked ? (
        <>
          <BackLink
            href={`/${tenantSlug}/field/locations/${visit.locationId}`}
            label={t("backToLocation")}
          />
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
            href={`/${tenantSlug}/field/locations/${visit.locationId}`}
            inline
            label={t("backToLocation")}
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
        <FieldVisitReportForm
          products={productsResult?.ok ? productsResult.data : []}
          shelfProducts={shelfProducts}
          tenantSlug={tenantSlug}
          visitId={visitId}
          voiceHint={
            voiceHintResult?.ok ? voiceHintResult.data.voiceHint : null
          }
        />
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
