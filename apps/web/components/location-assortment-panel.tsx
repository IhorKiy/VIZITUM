import { useFormatter, useTranslations } from "next-intl";

import type { AssortmentStatus, LocationAssortment } from "../lib/api-client";
import { ASSORTMENT_STATUSES } from "../lib/assortment-status";
import { formatDate, formatEnumLabel } from "../lib/format";
import { ChevronDownIcon, PackageIcon, TrashIcon } from "./icons";
import { LocationAssortmentModal } from "./location-assortment-modal";
import { PendingSubmitButton } from "./pending-submit-button";

const STATUS_TONE: Record<AssortmentStatus, string> = {
  in_stock: "active",
  out_of_stock: "danger",
  to_order: "warning",
  not_relevant: "neutral",
};

type LocationAssortmentPanelProps = {
  rows: LocationAssortment[];
  availableProducts: { id: string; name: string; sku: string | null }[];
  canManage: boolean;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
  // Only read when canManage is true — read-only callers (the admin location
  // detail screen) omit them.
  upsertAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  // "inline" (default) renders rows read-only (admin, canManage=false) or as
  // editable forms when canManage; "cards" renders collapsible display cards
  // with a per-row edit modal (pencil) and delete (trash) — the field screen
  // uses this and drives adds from its own header "+" modal. locationName feeds
  // the edit modal's subtitle and is only read in "cards" mode.
  variant?: "inline" | "cards";
  locationName?: string;
};

// Shared by the field and admin location detail screens — mirrors
// LocationPotentialPanel's split (page owns the <details> chrome, this owns
// the body). The joined product is never spread flat: Product.status and
// this row's own status are different enums and would otherwise collide.
export function LocationAssortmentPanel({
  rows,
  availableProducts,
  canManage,
  coveragePct,
  requiredCount,
  inStockCount,
  upsertAction,
  deleteAction,
  variant = "inline",
  locationName = "",
}: LocationAssortmentPanelProps) {
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const showInlineAddForm =
    variant === "inline" && canManage && availableProducts.length > 0;

  const statusShort: Record<AssortmentStatus, string> = {
    in_stock: t("assortmentStatusShort.in_stock"),
    out_of_stock: t("assortmentStatusShort.out_of_stock"),
    to_order: t("assortmentStatusShort.to_order"),
    not_relevant: t("assortmentStatusShort.not_relevant"),
  };

  const number = (value: number | null) =>
    value == null ? "—" : String(value);

  return (
    <div className="field-card-list">
      {requiredCount > 0 ? (
        <p className="form-hint">
          {t("coverageSummary", {
            pct: coveragePct,
            inStock: inStockCount,
            required: requiredCount,
          })}
        </p>
      ) : null}

      {rows.length === 0 ? (
        variant === "cards" ? (
          <div className="empty-state-panel location-insights-empty">
            <span className="location-insights-empty-icon" aria-hidden="true">
              <PackageIcon size={28} />
            </span>
            <h2>{t("assortmentEmptyTitle")}</h2>
            <p>{t("assortmentEmptyHint")}</p>
          </div>
        ) : (
          <p className="empty-state">{t("assortmentEmpty")}</p>
        )
      ) : null}

      {rows.map((row) =>
        variant === "cards" ? (
          <details className="location-insight-card" key={row.id}>
            <summary className="location-insight-card-summary">
              <h3>{row.product.name}</h3>
              <span className="location-insight-card-summary-right">
                <span
                  aria-label={formatEnumLabel(tCommon, row.status)}
                  className={`assortment-status-badge assortment-status-badge--${STATUS_TONE[row.status]}`}
                  title={formatEnumLabel(tCommon, row.status)}
                >
                  {statusShort[row.status]}
                </span>
                <span
                  className="location-insight-card-chevron"
                  aria-hidden="true"
                >
                  <ChevronDownIcon />
                </span>
              </span>
            </summary>
            <div className="location-insight-card-body">
              <div className="location-insight-summary-row">
                {row.product.sku || row.product.category ? (
                  <p className="location-potential-meta">
                    {[row.product.sku, row.product.category]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {row.shouldBeListed ? (
                  <span className="location-insight-pill">
                    {t("assortmentRequired")}
                  </span>
                ) : null}
                {row.lastCheckedAt ? (
                  <span className="location-insight-pill">
                    {formatDate(format, row.lastCheckedAt)}
                  </span>
                ) : null}
              </div>
              <div className="location-insight-tiles">
                {[
                  {
                    key: "stock",
                    label: t("assortmentModal.stock"),
                    value: row.lastStock,
                  },
                  {
                    key: "order",
                    label: t("assortmentModal.order"),
                    value: row.lastOrder,
                  },
                  {
                    key: "sale",
                    label: t("assortmentModal.sale"),
                    value: row.lastSale,
                  },
                ].map((tile) => (
                  <div className="location-insight-tile" key={tile.key}>
                    <span className="location-insight-tile-label">
                      {tile.label}
                    </span>
                    <span className="location-insight-tile-value">
                      {number(tile.value)}
                    </span>
                  </div>
                ))}
              </div>
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
          </details>
        ) : (
          <article className="location-mini-card" key={row.id}>
            {canManage ? (
              <form action={upsertAction} className="visit-form compact">
                <input name="productId" type="hidden" value={row.productId} />
                <h3 className="visit-form-full">
                  {row.product.name}
                  {row.product.sku ? ` · ${row.product.sku}` : ""}
                </h3>
                <label className="checkbox-label visit-form-full">
                  <input
                    defaultChecked={row.shouldBeListed}
                    name="shouldBeListed"
                    type="checkbox"
                  />
                  {t("shouldBeListed")}
                </label>
                <label>
                  {t("status")}
                  <select defaultValue={row.status} name="status">
                    {ASSORTMENT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {formatEnumLabel(tCommon, status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("lastStock")}
                  <input
                    defaultValue={row.lastStock ?? ""}
                    min={0}
                    name="lastStock"
                    type="number"
                  />
                </label>
                <label>
                  {t("lastOrder")}
                  <input
                    defaultValue={row.lastOrder ?? ""}
                    min={0}
                    name="lastOrder"
                    type="number"
                  />
                </label>
                <label>
                  {t("lastSale")}
                  <input
                    defaultValue={row.lastSale ?? ""}
                    min={0}
                    name="lastSale"
                    type="number"
                  />
                </label>
                <label>
                  {t("lastCheckedAt")}
                  <input
                    defaultValue={row.lastCheckedAt ?? ""}
                    name="lastCheckedAt"
                    type="date"
                  />
                </label>
                <label className="visit-form-full">
                  {t("comment")}
                  <textarea
                    defaultValue={row.comment ?? ""}
                    name="comment"
                    rows={2}
                  />
                </label>
                <PendingSubmitButton
                  className="secondary-button"
                  pendingLabel={tCommon("saving")}
                >
                  {tCommon("save")}
                </PendingSubmitButton>
              </form>
            ) : (
              <header>
                <div>
                  <h3>
                    {row.product.name}
                    {row.product.sku ? ` · ${row.product.sku}` : ""}
                  </h3>
                  <p>{row.shouldBeListed ? t("shouldBeListed") : ""}</p>
                </div>
                <span className="status-pill">
                  {formatEnumLabel(tCommon, row.status)}
                </span>
              </header>
            )}
            {canManage ? (
              <form action={deleteAction}>
                <input name="productId" type="hidden" value={row.productId} />
                <PendingSubmitButton
                  className="secondary-button danger"
                  pendingLabel={tCommon("saving")}
                >
                  {t("remove")}
                </PendingSubmitButton>
              </form>
            ) : null}
          </article>
        ),
      )}

      {showInlineAddForm ? (
        <form action={upsertAction} className="visit-form compact">
          <label className="visit-form-full">
            {t("product")}
            <select defaultValue="" name="productId" required>
              <option disabled value="">
                {t("selectProduct")}
              </option>
              {availableProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.sku ? ` · ${product.sku}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label visit-form-full">
            <input defaultChecked name="shouldBeListed" type="checkbox" />
            {t("shouldBeListed")}
          </label>
          <label>
            {t("status")}
            <select defaultValue="in_stock" name="status">
              {ASSORTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatEnumLabel(tCommon, status)}
                </option>
              ))}
            </select>
          </label>
          <PendingSubmitButton
            className="secondary-button"
            pendingLabel={tCommon("saving")}
          >
            {t("addProduct")}
          </PendingSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
