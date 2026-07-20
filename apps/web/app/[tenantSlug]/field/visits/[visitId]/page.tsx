import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../../components/app-shell";
import { ConfirmedFieldReportSummary } from "../../../../../components/confirmed-field-report-summary";
import { FieldVisitReportForm } from "../../../../../components/field-visit-report-form";
import {
  getCurrentSession,
  getVisit,
  getVisitReport,
  listAllProducts,
} from "../../../../../lib/api-client";
import { isDemoFallbackEnabled } from "../../../../../lib/demo-mode";

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
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{demoName ?? t("demoStatus")}</h1>
            <p>{demoAddress ?? ""}</p>
          </div>
          <div className="toolbar" aria-label={t("visitActions")}>
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              {tField("backToRoute")}
            </a>
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
        <header className="page-header">
          <div>
            <p className="eyebrow">{tField("flowEyebrow")}</p>
            <h1>{t("notFoundTitle")}</h1>
          </div>
          <div className="toolbar" aria-label={t("visitActions")}>
            <a className="secondary-button" href={`/${tenantSlug}/field`}>
              {tField("backToRoute")}
            </a>
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

  const [productsResult, reportResult] = await Promise.all([
    isLocked ? Promise.resolve(null) : listAllProducts(),
    isLocked ? getVisitReport(visitId) : Promise.resolve(null),
  ]);
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
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{visit.location.name}</h1>
          <p>{locationAddress}</p>
        </div>
        <div className="toolbar" aria-label={t("visitActions")}>
          <a
            className="secondary-button"
            href={`/${tenantSlug}/field/locations/${visit.locationId}`}
          >
            {t("backToLocation")}
          </a>
        </div>
      </header>

      {isLocked ? (
        reportResult?.ok ? (
          <article className="visit-card">
            <ConfirmedFieldReportSummary
              confirmedAt={reportResult.data.confirmedAt}
              confirmedData={reportResult.data.confirmedData}
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
          locationAddress={locationAddress}
          locationName={visit.location.name}
          products={productsResult?.ok ? productsResult.data : []}
          tenantSlug={tenantSlug}
          visitId={visitId}
        />
      )}
    </AppShell>
  );
}
