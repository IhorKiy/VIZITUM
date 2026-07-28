import { useFormatter, useTranslations } from "next-intl";

import type { AssortmentStatus, LocationAssortment } from "../lib/api-client";
import { formatDate, formatEnumLabel } from "../lib/format";
import { PackageIcon, TrashIcon } from "./icons";
import { LocationAssortmentModal } from "./location-assortment-modal";
import { PendingSubmitButton } from "./pending-submit-button";

// A null status is its own state, not a missing value: the product is in the
// matrix but no visit has confirmed the shelf yet.
const STATUS_TONE: Record<AssortmentStatus, string> = {
  in_stock: "active",
  out_of_stock: "danger",
};
const UNCHECKED_TONE = "neutral";

type LocationAssortmentPanelProps = {
  rows: LocationAssortment[];
  canManage: boolean;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
  checkedCount: number;
  // Only read when canManage is true — read-only callers (the admin location
  // detail screen) omit them.
  upsertAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  // "inline" (default) renders compact read-only rows (the admin location
  // detail screen); "cards" renders display cards with a per-row edit modal
  // (pencil) and delete (trash) when canManage — the manager screen uses this
  // and drives adds from its own header "+" modal, the field screen uses it
  // read-only. locationName feeds the edit modal's subtitle and is only read
  // in "cards" mode.
  variant?: "inline" | "cards";
  locationName?: string;
};

// Shared by the manager, field and admin location detail screens — mirrors
// LocationPotentialPanel's split (page owns the <details> chrome, this owns
// the body). The joined product is never spread flat: Product.status and
// this row's own status are different enums and would otherwise collide.
export function LocationAssortmentPanel({
  rows,
  canManage,
  coveragePct,
  requiredCount,
  inStockCount,
  checkedCount,
  upsertAction,
  deleteAction,
  variant = "inline",
  locationName = "",
}: LocationAssortmentPanelProps) {
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const format = useFormatter();

  const statusShort: Record<AssortmentStatus, string> = {
    in_stock: t("assortmentStatusShort.in_stock"),
    out_of_stock: t("assortmentStatusShort.out_of_stock"),
  };
  const statusLabel = (status: AssortmentStatus | null) =>
    status ? formatEnumLabel(tCommon, status) : t("assortmentUnchecked");

  return (
    <div className="field-card-list">
      {/* A percentage nobody has earned yet would read as a verdict on the
          shelf, so an unchecked matrix says so instead of showing 0%. */}
      {requiredCount > 0 ? (
        checkedCount === 0 ? (
          <p className="form-hint">{t("coverageUnchecked")}</p>
        ) : (
          <p className="form-hint">
            {t("coverageSummary", {
              pct: coveragePct,
              inStock: inStockCount,
              required: requiredCount,
            })}
            {checkedCount < requiredCount
              ? ` · ${t("coverageUncheckedCount", {
                  count: requiredCount - checkedCount,
                })}`
              : ""}
          </p>
        )
      ) : null}

      {rows.length === 0 ? (
        variant === "cards" ? (
          <div className="empty-state-panel location-insights-empty">
            <span className="location-insights-empty-icon" aria-hidden="true">
              <PackageIcon size={28} />
            </span>
            <h2>{t("assortmentEmptyTitle")}</h2>
            {/* Same split as the potential panel: the field zone reads this
                matrix, the manager authors it, so only a manager is told to
                fill it in. */}
            <p>
              {canManage
                ? t("assortmentEmptyHint")
                : t("assortmentEmptyReadOnlyHint")}
            </p>
          </div>
        ) : (
          <p className="empty-state">{t("assortmentEmpty")}</p>
        )
      ) : null}

      {rows.map((row) =>
        variant === "cards" ? (
          <div className="location-insight-card" key={row.id}>
            <div className="location-insight-card-summary">
              <h3>{row.product.name}</h3>
              <div className="location-insight-card-summary-right">
                <span
                  aria-label={statusLabel(row.status)}
                  className={`assortment-status-badge assortment-status-badge--${
                    row.status ? STATUS_TONE[row.status] : UNCHECKED_TONE
                  }`}
                  title={statusLabel(row.status)}
                >
                  {row.status
                    ? statusShort[row.status]
                    : t("assortmentStatusShort.unchecked")}
                </span>
                {canManage && upsertAction && deleteAction ? (
                  <div className="location-insight-card-actions">
                    <LocationAssortmentModal
                      action={upsertAction}
                      canManage={canManage}
                      locationName={locationName}
                      mode="edit"
                      row={row}
                    />
                    <form action={deleteAction}>
                      <input
                        name="productId"
                        type="hidden"
                        value={row.productId}
                      />
                      <PendingSubmitButton
                        aria-label={t("remove")}
                        className="location-insight-action location-insight-action--danger"
                        pendingLabel="…"
                      >
                        <TrashIcon />
                      </PendingSubmitButton>
                    </form>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="location-insight-card-body">
              <div className="location-insight-summary-row">
                {row.product.sku || row.product.category ? (
                  <p className="location-potential-meta">
                    {[row.product.sku, row.product.category]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {/* The exception carries the pill, not the rule: almost every
                    row is in the matrix (the flag defaults to true and the add
                    modal starts there), so marking those said nothing and left
                    "not required" indistinguishable from "nobody set it". A
                    row without the matrix flag is the one the visit report
                    never asks about and coverage ignores — that is what is
                    worth a word here. */}
                {row.shouldBeListed ? null : (
                  <span className="location-insight-pill">
                    {t("assortmentOptional")}
                  </span>
                )}
                {/* Says when the shelf was last looked at, rather than
                    showing a bare date whose meaning has to be guessed. */}
                <span className="location-insight-pill">
                  {row.lastCheckedAt
                    ? t("assortmentCheckedOn", {
                        date: formatDate(format, row.lastCheckedAt),
                      })
                    : t("assortmentUnchecked")}
                </span>
              </div>
            </div>
          </div>
        ) : (
          // Read-only by construction: the one screen on this variant (admin
          // location detail) never manages the matrix, and editing lives in
          // the "cards" variant's modal.
          <article className="location-mini-card" key={row.id}>
            <header>
              <div>
                <h3>
                  {row.product.name}
                  {row.product.sku ? ` · ${row.product.sku}` : ""}
                </h3>
                {/* Same rule as the card variant: only the off-matrix row
                    says anything. */}
                {row.shouldBeListed ? null : <p>{t("assortmentOptional")}</p>}
              </div>
              {/* The tone is not decoration: `.status-pill` paints white text
                  and leaves the background to the modifier, so a bare pill is
                  invisible on this card. */}
              <span
                className={`status-pill ${
                  row.status ? STATUS_TONE[row.status] : UNCHECKED_TONE
                }`}
              >
                {statusLabel(row.status)}
              </span>
            </header>
          </article>
        ),
      )}
    </div>
  );
}
