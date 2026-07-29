import { useFormatter, useTranslations } from "next-intl";

import { formatDate, formatDateTime } from "../lib/format";

type ConfirmedProductUpdate = {
  productName: string;
  productCode: string | null;
  status: string | null;
  stock: number | null;
  order: number | null;
  sale: number | null;
  comment: string;
};

type ConfirmedProblem = {
  type: string | null;
  note: string;
  photoObjectId: string | null;
  photoContentType: string | null;
};

type ConfirmedFieldReport = {
  visitDate: string | null;
  outcome: string | null;
  orderPlaced: boolean | null;
  noOrderReason: string | null;
  stockStatus: string | null;
  presentedProducts: Array<{ id: string; name: string; sku: string | null }>;
  notes: string;
  nextAction: string;
  nextActionDueDate: string | null;
  productUpdates: ConfirmedProductUpdate[];
  problem: ConfirmedProblem | null;
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
  problemPhotoUrl,
}: {
  confirmedData: unknown;
  confirmedAt: string;
  // Presigned by the page (this component stays sync so it can keep using
  // useTranslations); null when there is no photo or the link could not be
  // signed — the problem itself still renders either way.
  problemPhotoUrl?: string | null;
}) {
  const t = useTranslations("field.visit");
  const format = useFormatter();
  const data = normalizeConfirmedData(confirmedData);
  const empty = t("confirmedEmptyValue");
  const backdatedVisitDate = backdatedVisitDateOf(
    data.fieldReport.visitDate,
    confirmedAt,
  );

  return (
    <section className="report-detail-list">
      <div className="panel-title-stack">
        <h2>{t("confirmedTitle")}</h2>
        <p>{t("confirmedAt", { date: formatDateTime(format, confirmedAt) })}</p>
        {backdatedVisitDate ? (
          <p>
            {t("visitDateLabel")}: {formatDate(format, backdatedVisitDate)} ·{" "}
            {t("confirmedBackdatedHint")}
          </p>
        ) : null}
      </div>

      <div className="report-detail-section">
        <h3>{t("confirmedSummary")}</h3>
        <p>{data.summary || empty}</p>
      </div>

      <div className="report-detail-section">
        <h3>{t("outcomeLabel")}</h3>
        <p>{formatResult(t, data.fieldReport, empty)}</p>
      </div>

      {data.fieldReport.orderPlaced === false ? (
        <div className="report-detail-section">
          <h3>{t("noOrderReasonLabel")}</h3>
          <p>{formatNoOrderReason(t, data.fieldReport.noOrderReason, empty)}</p>
        </div>
      ) : null}

      {data.fieldReport.problem ? (
        <div className="report-detail-section">
          <h3>{t("confirmedProblem")}</h3>
          <p>
            {[
              formatProblemType(t, data.fieldReport.problem.type),
              data.fieldReport.problem.note,
            ]
              .filter(Boolean)
              .join(" · ") || empty}
          </p>
          {problemPhotoUrl ? (
            <a
              className="report-detail-photo"
              href={problemPhotoUrl}
              rel="noreferrer"
              target="_blank"
            >
              {isBrowserRenderableImage(
                data.fieldReport.problem.photoContentType,
              ) ? (
                /* A presigned storage URL on a per-request host: nothing
                   next/image could optimize or whitelist. */
                <img alt={t("confirmedProblemPhoto")} src={problemPhotoUrl} />
              ) : (
                // HEIC is what an iPhone shoots by default and only Safari
                // renders it, so everyone else gets a link to open rather
                // than a broken image.
                t("confirmedProblemPhotoOpen")
              )}
            </a>
          ) : data.fieldReport.problem.photoObjectId ? (
            <p>{t("confirmedProblemPhoto")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="report-detail-section">
        <h3>{t("confirmedNextAction")}</h3>
        <p>{data.fieldReport.nextAction || empty}</p>
        {data.fieldReport.nextAction && data.fieldReport.nextActionDueDate ? (
          <p>
            {t("nextActionDueDateLabel")}:{" "}
            {formatDate(format, data.fieldReport.nextActionDueDate, empty)}
          </p>
        ) : null}
      </div>

      <div className="report-detail-section">
        <h3>{t("stockStatusLabel")}</h3>
        <p>{formatStockStatus(t, data.fieldReport.stockStatus, empty)}</p>
      </div>

      {/* Presented products are only ever present on reports confirmed before
          the shelf check replaced the per-SKU picker, so the section appears
          only when one actually carries them. */}
      {data.fieldReport.presentedProducts.length > 0 ? (
        <div className="report-detail-section">
          <h3>{t("confirmedPresentedProducts")}</h3>
          <div className="chip-list">
            {data.fieldReport.presentedProducts.map((product) => (
              <span className="chip" key={product.id}>
                <span>
                  {[product.sku, product.name].filter(Boolean).join(" · ")}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

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
                  {[
                    formatSkuStatus(t, update.status, empty),
                    // Quantities only came from the old per-SKU cards; a
                    // shelf-check row has none, and printing "-" three times
                    // for every product would bury the status that matters.
                    update.stock !== null
                      ? `${t("skuStockLabel")}: ${update.stock}`
                      : null,
                    update.order !== null
                      ? `${t("skuOrderLabel")}: ${update.order}`
                      : null,
                    update.sale !== null
                      ? `${t("skuSaleLabel")}: ${update.sale}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
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
    </section>
  );
}

// The visit date surfaces only when it differs from the confirm — the form
// defaults it to "today", so on the overwhelming majority of reports a date
// line would repeat the confirm timestamp one row up. When it does differ,
// the hint marks the report as entered retroactively, so a reconstructed
// visit is distinguishable from a live one. The comparison is day-granular
// against the confirm's UTC date: a late-evening confirm can flag a same-day
// report spuriously by one day, which is acceptable for an informational
// marker. The regex guard keeps legacy reports with garbage dates (written
// before write-time validation existed) from crashing formatDate.
function backdatedVisitDateOf(
  visitDate: string | null,
  confirmedAt: string,
): string | null {
  return visitDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(visitDate) &&
    visitDate < confirmedAt.slice(0, 10)
    ? visitDate
    : null;
}

// Reports confirmed before the form recorded the order as a fact only carry
// the derived positive/neutral/negative outcome, so they keep rendering that
// wording rather than showing an empty result.
function formatResult(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  fieldReport: ConfirmedFieldReport,
  empty: string,
): string {
  if (fieldReport.orderPlaced === true) return t("resultOrderPlaced");
  if (fieldReport.orderPlaced === false) return t("resultNoOrder");
  if (fieldReport.outcome === "positive") return t("outcomePositive");
  if (fieldReport.outcome === "neutral") return t("outcomeNeutral");
  if (fieldReport.outcome === "negative") return t("outcomeNegative");
  return empty;
}

// Types every browser can paint. A photo stored as something else (HEIC from
// an iPhone) is still reachable — as a link, not an <img> that renders broken
// outside Safari. An unknown/absent type is treated as renderable: it only
// ever comes from reports written before the type was recorded, which were
// jpeg/png in practice.
function isBrowserRenderableImage(contentType: string | null): boolean {
  return contentType === null || !/^image\/(heic|heif)$/.test(contentType);
}

function formatProblemType(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  type: string | null,
): string {
  if (type === "return") return t("problemTypeReturn");
  if (type === "damaged") return t("problemTypeDamaged");
  if (type === "expired") return t("problemTypeExpired");
  if (type === "conflict") return t("problemTypeConflict");
  return "";
}

function formatNoOrderReason(
  t: ReturnType<typeof useTranslations<"field.visit">>,
  reason: string | null,
  empty: string,
): string {
  if (reason === "closed") return t("noOrderReasonClosed");
  if (reason === "no_decision_maker") return t("noOrderReasonNoDecisionMaker");
  if (reason === "has_stock") return t("noOrderReasonHasStock");
  if (reason === "no_money") return t("noOrderReasonNoMoney");
  if (reason === "refused") return t("noOrderReasonRefused");
  if (reason === "other") return t("noOrderReasonOther");
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
      orderPlaced:
        typeof fieldReport.orderPlaced === "boolean"
          ? fieldReport.orderPlaced
          : null,
      noOrderReason:
        typeof fieldReport.noOrderReason === "string"
          ? fieldReport.noOrderReason
          : null,
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
      nextActionDueDate:
        typeof fieldReport.nextActionDueDate === "string"
          ? fieldReport.nextActionDueDate
          : null,
      productUpdates: normalizeProductUpdates(fieldReport.productUpdates),
      problem: normalizeProblem(fieldReport.problem),
    },
  };
}

function normalizeProblem(value: unknown): ConfirmedProblem | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    type: typeof value.type === "string" ? value.type : null,
    note: typeof value.note === "string" ? value.note : "",
    photoObjectId:
      typeof value.photoObjectId === "string" ? value.photoObjectId : null,
    photoContentType:
      typeof value.photoContentType === "string"
        ? value.photoContentType
        : null,
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
