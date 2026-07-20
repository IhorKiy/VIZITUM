import { useTranslations } from "next-intl";

import type { AssortmentStatus, LocationAssortment } from "../lib/api-client";
import { formatEnumLabel } from "../lib/format";
import { PendingSubmitButton } from "./pending-submit-button";

const ASSORTMENT_STATUSES: AssortmentStatus[] = [
  "in_stock",
  "out_of_stock",
  "to_order",
  "not_relevant",
];

type LocationAssortmentPanelProps = {
  rows: LocationAssortment[];
  availableProducts: { id: string; name: string; sku: string | null }[];
  canManage: boolean;
  coveragePct: number;
  requiredCount: number;
  inStockCount: number;
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
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
}: LocationAssortmentPanelProps) {
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");

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

      {rows.length === 0 && (!canManage || availableProducts.length === 0) ? (
        <p className="empty-state">{t("assortmentEmpty")}</p>
      ) : (
        rows.map((row) => (
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
        ))
      )}

      {canManage && availableProducts.length > 0 ? (
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
