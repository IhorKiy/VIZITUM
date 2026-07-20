import { useFormatter, useTranslations } from "next-intl";

import { formatDateTime } from "../lib/format";

type ConfirmedProductUpdate = {
  productName: string;
  productCode: string | null;
  status: string | null;
  stock: number | null;
  order: number | null;
  sale: number | null;
  comment: string;
};

type ConfirmedFieldReport = {
  visitDate: string | null;
  outcome: string | null;
  stockStatus: string | null;
  presentedProducts: Array<{ id: string; name: string; sku: string | null }>;
  notes: string;
  nextAction: string;
  productUpdates: ConfirmedProductUpdate[];
};

type NormalizedConfirmedData = {
  summary: string;
  fieldReport: ConfirmedFieldReport;
};

// Renders the read-only view of a confirmed `field-report.v1` report
// (visits.service.ts's confirmReport locks the visit as "completed" the
// moment a report is confirmed, so there's no further editing — only this
// summary). A plain server component (no "use client") following the same
// useTranslations/useFormatter-in-RSC pattern as import-tables.tsx.
export function ConfirmedFieldReportSummary({
  confirmedData,
  confirmedAt,
}: {
  confirmedData: unknown;
  confirmedAt: string;
}) {
  const t = useTranslations("field.visit");
  const format = useFormatter();
  const data = normalizeConfirmedData(confirmedData);
  const empty = t("confirmedEmptyValue");

  return (
    <section className="report-detail-list">
      <div className="panel-title-stack">
        <h2>{t("confirmedTitle")}</h2>
        <p>{t("confirmedAt", { date: formatDateTime(format, confirmedAt) })}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("confirmedSummary")}</h3>
        <p>{data.summary || empty}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("outcomeLabel")}</h3>
        <p>{formatOutcome(t, data.fieldReport.outcome, empty)}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("stockStatusLabel")}</h3>
        <p>{formatStockStatus(t, data.fieldReport.stockStatus, empty)}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("confirmedPresentedProducts")}</h3>
        {data.fieldReport.presentedProducts.length > 0 ? (
          <div className="chip-list">
            {data.fieldReport.presentedProducts.map((product) => (
              <span className="chip" key={product.id}>
                <span>
                  {[product.sku, product.name].filter(Boolean).join(" · ")}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p>{empty}</p>
        )}
      </div>

      <div className="report-detail-section">
        <h3>{t("confirmedProductUpdates")}</h3>
        {data.fieldReport.productUpdates.length > 0 ? (
          <div className="report-detail-cards">
            {data.fieldReport.productUpdates.map((update, index) => (
              <article
                className="report-detail-card"
                key={`${update.productName}-${index}`}
              >
                <strong>
                  {[update.productCode, update.productName]
                    .filter(Boolean)
                    .join(" · ")}
                </strong>
                <span>
                  {formatSkuStatus(t, update.status, empty)}
                  {" · "}
                  {t("skuStockLabel")}: {update.stock ?? empty}
                  {" · "}
                  {t("skuOrderLabel")}: {update.order ?? empty}
                  {" · "}
                  {t("skuSaleLabel")}: {update.sale ?? empty}
                </span>
                {update.comment ? <p>{update.comment}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <p>{empty}</p>
        )}
      </div>

      <div className="report-detail-section">
        <h3>{t("notesLabel")}</h3>
        <p>{data.fieldReport.notes || empty}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("confirmedNextAction")}</h3>
        <p>{data.fieldReport.nextAction || empty}</p>
      </div>
    </section>
  );
}

function formatOutcome(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  outcome: string | null,
  empty: string,
): string {
  if (outcome === "positive") return t("outcomePositive");
  if (outcome === "neutral") return t("outcomeNeutral");
  if (outcome === "negative") return t("outcomeNegative");
  return empty;
}

function formatStockStatus(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  stockStatus: string | null,
  empty: string,
): string {
  if (stockStatus === "in_stock") return t("stockInStock");
  if (stockStatus === "low_stock") return t("stockLowStock");
  if (stockStatus === "out_of_stock") return t("stockOutOfStock");
  return empty;
}

function formatSkuStatus(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  status: string | null,
  empty: string,
): string {
  if (status === "in_stock") return t("skuStatusInStock");
  if (status === "out_of_stock") return t("skuStatusOutOfStock");
  if (status === "to_order") return t("skuStatusToOrder");
  if (status === "not_relevant") return t("skuStatusNotRelevant");
  return empty;
}

function normalizeConfirmedData(value: unknown): NormalizedConfirmedData {
  const record = isRecord(value) ? value : {};
  const fieldReport = isRecord(record.fieldReport) ? record.fieldReport : {};

  return {
    summary: typeof record.summary === "string" ? record.summary : "",
    fieldReport: {
      visitDate:
        typeof fieldReport.visitDate === "string"
          ? fieldReport.visitDate
          : null,
      outcome:
        typeof fieldReport.outcome === "string" ? fieldReport.outcome : null,
      stockStatus:
        typeof fieldReport.stockStatus === "string"
          ? fieldReport.stockStatus
          : null,
      presentedProducts: normalizePresentedProducts(
        fieldReport.presentedProducts,
      ),
      notes: typeof fieldReport.notes === "string" ? fieldReport.notes : "",
      nextAction:
        typeof fieldReport.nextAction === "string"
          ? fieldReport.nextAction
          : "",
      productUpdates: normalizeProductUpdates(fieldReport.productUpdates),
    },
  };
}

function normalizePresentedProducts(
  value: unknown,
): Array<{ id: string; name: string; sku: string | null }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string"
    ) {
      return [];
    }

    return [
      {
        id: item.id,
        name: item.name,
        sku: typeof item.sku === "string" ? item.sku : null,
      },
    ];
  });
}

function normalizeProductUpdates(value: unknown): ConfirmedProductUpdate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.productName !== "string") {
      return [];
    }

    return [
      {
        productName: item.productName,
        productCode:
          typeof item.productCode === "string" ? item.productCode : null,
        status: typeof item.status === "string" ? item.status : null,
        stock: typeof item.stock === "number" ? item.stock : null,
        order: typeof item.order === "number" ? item.order : null,
        sale: typeof item.sale === "number" ? item.sale : null,
        comment: typeof item.comment === "string" ? item.comment : "",
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
