import { getFormatter, getTranslations } from "next-intl/server";

import { AppShell } from "../../../../components/app-shell";
import {
  getCurrentSession,
  getLocationInsightsSummary,
} from "../../../../lib/api-client";

type ManagerPotentialPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function ManagerPotentialPage({
  params,
}: ManagerPotentialPageProps) {
  const { tenantSlug } = await params;
  const [t, tManager, tCommon, tLocationInsights, format] = await Promise.all([
    getTranslations("manager.potential"),
    getTranslations("manager"),
    getTranslations("common"),
    getTranslations("common.locationInsights"),
    getFormatter(),
  ]);
  const sessionResult = await getCurrentSession();

  if (
    !sessionResult.ok ||
    !sessionResult.data.permissions.includes("dashboard.manager.read")
  ) {
    return (
      <AppShell activeArea="manager-potential" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
          <div className="toolbar">
            <a className="primary-button" href={`/${tenantSlug}/login`}>
              {tCommon("signIn")}
            </a>
          </div>
        </header>
      </AppShell>
    );
  }

  if (!sessionResult.data.productsEnabled) {
    return (
      <AppShell activeArea="manager-potential" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
        </header>
        <section className="notice-panel" aria-label={t("disabledAria")}>
          <div>
            <h2>{t("disabledTitle")}</h2>
            <p>{t("disabledBody")}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const summaryResult = await getLocationInsightsSummary();

  if (!summaryResult.ok) {
    return (
      <AppShell activeArea="manager-potential" tenantSlug={tenantSlug}>
        <header className="page-header">
          <div>
            <p className="eyebrow">{tManager("eyebrow")}</p>
            <h1>{t("title")}</h1>
          </div>
        </header>
        <section
          className="notice-panel danger"
          aria-label={tCommon("notice.apiStatus")}
        >
          <div>
            <p className="eyebrow">{tCommon("notice.connectionRequired")}</p>
            <h2>{t("notConnectedTitle")}</h2>
            <p>{summaryResult.message}</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const summary = summaryResult.data;
  // The manager zone has its own location screen now, so a low-coverage row
  // leads straight to the assortment that explains the number — no more
  // bouncing into admin chrome (or, without the admin zone, to a bare list).
  const highPotentialLocationHref = (locationId: string) =>
    `/${tenantSlug}/manager/locations/${locationId}`;

  return (
    <AppShell activeArea="manager-potential" tenantSlug={tenantSlug}>
      <header className="page-header">
        <div>
          <p className="eyebrow">{tManager("eyebrow")}</p>
          <h1>{t("title")}</h1>
        </div>
      </header>

      <section className="manager-grid" aria-label={t("metricsAria")}>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("totalPotential")}</p>
          </header>
          <p className="metric-value">
            {format.number(summary.totalPotential)}
          </p>
          <p className="small-label">
            {t("planTotals", {
              m1: format.number(summary.planMonth1),
              m2: format.number(summary.planMonth2),
              m3: format.number(summary.planMonth3),
            })}
          </p>
        </article>
        <article className="metric-card">
          <header>
            <p className="metric-label">{t("overallCoverage")}</p>
          </header>
          <p className="metric-value">{summary.overallCoveragePct}%</p>
          <p className="small-label">
            {t("coverageDetail", {
              inStock: summary.inStockCount,
              required: summary.requiredCount,
            })}
          </p>
        </article>
      </section>

      <section aria-label={t("highPotentialLowCoverage")} className="panel">
        <h2>{t("highPotentialLowCoverage")}</h2>
        {summary.highPotentialLowCoverage.length > 0 ? (
          <ul className="list-cards">
            {summary.highPotentialLowCoverage.map((entry) => (
              <li className="list-card" key={entry.locationId}>
                <div className="list-card-top">
                  <h3 className="list-card-title">{entry.name}</h3>
                  <span className="status-pill warning">
                    {entry.coveragePct}%
                  </span>
                </div>
                <p className="form-hint">
                  {t("locationPotentialAmount", {
                    amount: format.number(entry.totalPotential),
                  })}
                </p>
                <div className="list-card-links">
                  <a
                    className="list-card-open"
                    href={highPotentialLocationHref(entry.locationId)}
                  >
                    {tLocationInsights("assortmentTitle")}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">{t("highPotentialLowCoverageEmpty")}</p>
        )}
      </section>

      <section aria-label={t("topProblemProducts")} className="panel">
        <h2>{t("topProblemProducts")}</h2>
        {summary.topProblemProducts.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>{tLocationInsights("product")}</th>
                <th>{t("problemCount")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.topProblemProducts.map((product) => (
                <tr key={product.productId}>
                  <td>
                    {product.name}
                    {product.sku ? ` · ${product.sku}` : ""}
                  </td>
                  <td>{product.problemCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-state">{t("topProblemProductsEmpty")}</p>
        )}
      </section>

      <section aria-label={t("potentialByCategory")} className="panel">
        <h2>{t("potentialByCategory")}</h2>
        {summary.potentialByCategory.length > 0 ? (
          <div className="locations-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{tLocationInsights("category")}</th>
                  <th>{t("totalPotential")}</th>
                  <th>{tLocationInsights("planMonth1")}</th>
                  <th>{tLocationInsights("planMonth2")}</th>
                  <th>{tLocationInsights("planMonth3")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.potentialByCategory.map((category) => (
                  <tr key={category.productCategoryId}>
                    <td>{category.name}</td>
                    <td>{format.number(category.totalPotential)}</td>
                    <td>{format.number(category.planMonth1)}</td>
                    <td>{format.number(category.planMonth2)}</td>
                    <td>{format.number(category.planMonth3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">{t("potentialByCategoryEmpty")}</p>
        )}
      </section>
    </AppShell>
  );
}
