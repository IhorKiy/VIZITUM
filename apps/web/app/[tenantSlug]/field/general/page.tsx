import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  getCurrentSession,
  listLocations,
  listProducts,
  listTasks,
  listTodayRoutes,
  listVisits,
} from "../../../../lib/api-client";

type GeneralPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function GeneralPage({ params }: GeneralPageProps) {
  const { tenantSlug } = await params;
  const [t, tField, tCommon] = await Promise.all([
    getTranslations("field.general"),
    getTranslations("field"),
    getTranslations("common"),
  ]);

  const sessionResult = await getCurrentSession();

  if (!sessionResult.ok) {
    return (
      <AppShell tenantSlug={tenantSlug} activeArea="field-general">
        <header className="page-header">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{t("title")}</h1>
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
        <section
          className="notice-panel"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{tCommon("notice.backendNotConnected")}</h2>
            <p>{sessionResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const [
    routesResult,
    visitsResult,
    locationsResult,
    tasksResult,
    productsResult,
  ] = await Promise.all([
    listTodayRoutes(),
    listVisits("pageSize=50"),
    listLocations(),
    listTasks("pageSize=50"),
    listProducts(),
  ]);

  const routes = routesResult.ok ? routesResult.data : [];
  const visits = visitsResult.ok ? visitsResult.data.items : [];
  const locations = locationsResult.ok ? locationsResult.data.items : [];
  const tasks = tasksResult.ok ? tasksResult.data.items : [];
  const products = productsResult.ok ? productsResult.data.items : [];

  const routeStops = routes.flatMap((plan) =>
    plan.items.filter((item) => item.status !== "skipped"),
  );
  const visitedStops = routeStops.filter(
    (item) => item.status === "visited",
  ).length;
  const openTasks = tasks.filter(
    (item) => item.status === "open" || item.status === "in_progress",
  );
  const completedVisits = visits.filter(
    (visit) => visit.status === "completed",
  ).length;

  return (
    <AppShell tenantSlug={tenantSlug} activeArea="field-general">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
        </div>
        <div className="toolbar" aria-label={t("generalActions")}>
          <a className="secondary-button" href={`/${tenantSlug}/field`}>
            {tField("backToRoute")}
          </a>
        </div>
      </header>

      <div className="general-stack">
        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("summary")}</h2>
          </summary>
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">{t("routeStops")}</th>
                <td>{routeStops.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("visited")}</th>
                <td>{visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">{t("remaining")}</th>
                <td>{routeStops.length - visitedStops}</td>
              </tr>
              <tr>
                <th scope="row">{t("completedVisits")}</th>
                <td>{completedVisits}</td>
              </tr>
              <tr>
                <th scope="row">{t("openTasks")}</th>
                <td>{openTasks.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("locations")}</th>
                <td>{locations.length}</td>
              </tr>
              <tr>
                <th scope="row">{t("products")}</th>
                <td>{products.length}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <section aria-label={t("catalogMetricsAria")} className="manager-grid">
          <Link className="metric-card" href={`/${tenantSlug}/field/locations`}>
            <header>
              <p className="metric-label">{t("locations")}</p>
              <span aria-hidden="true" className="metric-card-chevron">
                ›
              </span>
            </header>
            <p className="metric-value">{locations.length}</p>
            <p className="small-label">
              {t("locationsUnit", { count: locations.length })}
            </p>
          </Link>
          <Link className="metric-card" href={`/${tenantSlug}/field/products`}>
            <header>
              <p className="metric-label">{t("products")}</p>
              <span aria-hidden="true" className="metric-card-chevron">
                ›
              </span>
            </header>
            <p className="metric-value">{products.length}</p>
            <p className="small-label">
              {t("productsUnit", { count: products.length })}
            </p>
          </Link>
        </section>

        <details className="panel panel-collapsible">
          <summary className="panel-summary">
            <h2>{t("faq")}</h2>
          </summary>
          <div className="faq-list">
            <details className="faq-item">
              <summary className="faq-question">{t("faq1Question")}</summary>
              <p className="faq-answer">{t("faq1Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq2Question")}</summary>
              <p className="faq-answer">{t("faq2Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq3Question")}</summary>
              <p className="faq-answer">{t("faq3Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq4Question")}</summary>
              <p className="faq-answer">{t("faq4Answer")}</p>
            </details>
            <details className="faq-item">
              <summary className="faq-question">{t("faq5Question")}</summary>
              <p className="faq-answer">{t("faq5Answer")}</p>
            </details>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
