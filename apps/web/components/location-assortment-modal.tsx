"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { LocationAssortment } from "../lib/api-client";
import { ASSORTMENT_STATUSES } from "../lib/assortment-status";
import { formatEnumLabel } from "../lib/format";
import { PencilIcon, PlusIcon, SearchIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type ProductOption = { id: string; name: string; sku: string | null };

type LocationAssortmentModalProps = {
  action: (formData: FormData) => Promise<void>;
  canManage: boolean;
  locationName: string;
} & (
  | { mode: "add"; availableProducts: ProductOption[]; row?: never }
  | { mode: "edit"; row: LocationAssortment; availableProducts?: never }
);

function productLabel(name: string, sku: string | null): string {
  return sku ? `${name} · ${sku}` : name;
}

// Add-to-matrix / edit dialog for one assortment row. Adding uses a searchable
// product picker (a location can list hundreds of SKUs, so a plain <select> is
// unworkable); editing locks the product (it is the upsert key) and pre-fills.
// The matrix flag is shown as a static value — this dialog is framed as
// managing the required matrix, so shouldBeListed rides along as a hidden
// field rather than a toggle.
export function LocationAssortmentModal(props: LocationAssortmentModalProps) {
  const { action, canManage, locationName, mode } = props;
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const row = props.mode === "edit" ? props.row : null;
  const products = props.mode === "add" ? props.availableProducts : [];

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const [matrixRequired, setMatrixRequired] = useState(
    props.mode === "add" ? true : Boolean(props.row.shouldBeListed),
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? products.filter((product) =>
          productLabel(product.name, product.sku)
            .toLowerCase()
            .includes(needle),
        )
      : products;
    return base.slice(0, 50);
  }, [products, query]);

  if (!canManage) {
    return null;
  }
  if (props.mode === "add" && props.availableProducts.length === 0) {
    return null;
  }

  const title =
    mode === "add"
      ? t("assortmentModal.title")
      : t("assortmentModal.editTitle");
  const defaultStatus = row?.status ?? "in_stock";

  return (
    <>
      {mode === "add" ? (
        <button
          aria-haspopup="dialog"
          aria-label={title}
          className="location-feature-quick-add"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dialogRef.current?.showModal();
          }}
          onMouseDown={(event) => event.stopPropagation()}
          type="button"
        >
          <PlusIcon size={18} />
        </button>
      ) : (
        <button
          aria-haspopup="dialog"
          aria-label={title}
          className="location-potential-action"
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          <PencilIcon />
        </button>
      )}

      <dialog
        aria-labelledby={titleId}
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p className="modal-subtitle">{locationName}</p>
          </div>
          <button
            aria-label={tCommon("close")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          {props.mode === "add" ? (
            <label className="product-picker-label">
              <span>
                {t("assortmentModal.product")}{" "}
                <span aria-hidden="true" className="field-required">
                  *
                </span>
              </span>
              <div className="product-picker">
                <span className="product-picker-icon" aria-hidden="true">
                  <SearchIcon />
                </span>
                <input
                  autoComplete="off"
                  className="product-picker-input"
                  onBlur={() => window.setTimeout(() => setOpen(false), 120)}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedId("");
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  placeholder={t("assortmentModal.productPlaceholder")}
                  type="text"
                  value={query}
                />
                <span className="product-picker-chevron" aria-hidden="true">
                  ›
                </span>
                {open ? (
                  <ul className="product-picker-list">
                    {filtered.length > 0 ? (
                      filtered.map((product) => (
                        <li key={product.id}>
                          <button
                            className="product-picker-option"
                            onClick={() => {
                              setSelectedId(product.id);
                              setQuery(productLabel(product.name, product.sku));
                              setOpen(false);
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            type="button"
                          >
                            {productLabel(product.name, product.sku)}
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="product-picker-empty">
                        {t("assortmentModal.productEmpty")}
                      </li>
                    )}
                  </ul>
                ) : null}
              </div>
              <input name="productId" type="hidden" value={selectedId} />
            </label>
          ) : (
            <div className="modal-static-field">
              <input
                name="productId"
                type="hidden"
                value={props.row.productId}
              />
              <span className="modal-static-label">
                {t("assortmentModal.product")}
              </span>
              <span className="modal-static-value">
                {productLabel(props.row.product.name, props.row.product.sku)}
              </span>
            </div>
          )}

          <label>
            {t("assortmentModal.status")}
            <select defaultValue={defaultStatus} name="status">
              {ASSORTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatEnumLabel(tCommon, status)}
                </option>
              ))}
            </select>
          </label>

          <div className="modal-static-field">
            <span className="modal-static-label">
              {t("assortmentModal.matrix")}
            </span>
            <div
              aria-label={t("assortmentModal.matrix")}
              className="matrix-switch"
              role="group"
            >
              <button
                aria-pressed={matrixRequired}
                className={`matrix-switch-option ${
                  matrixRequired ? "matrix-switch-option--active" : ""
                }`}
                onClick={() => setMatrixRequired(true)}
                type="button"
              >
                {t("assortmentModal.matrixRequired")}
              </button>
              <button
                aria-pressed={!matrixRequired}
                className={`matrix-switch-option ${
                  matrixRequired ? "" : "matrix-switch-option--active"
                }`}
                onClick={() => setMatrixRequired(false)}
                type="button"
              >
                {t("assortmentModal.matrixOptional")}
              </button>
            </div>
          </div>
          {matrixRequired ? (
            <input name="shouldBeListed" type="hidden" value="true" />
          ) : null}

          <div className="modal-month-row">
            <label>
              {t("assortmentModal.stock")}
              <input
                defaultValue={row?.lastStock ?? undefined}
                min={0}
                name="lastStock"
                placeholder={t("assortmentModal.stockPlaceholder")}
                type="number"
              />
            </label>
            <label>
              {t("assortmentModal.order")}
              <input
                defaultValue={row?.lastOrder ?? undefined}
                min={0}
                name="lastOrder"
                placeholder={t("assortmentModal.orderPlaceholder")}
                type="number"
              />
            </label>
            <label>
              {t("assortmentModal.sale")}
              <input
                defaultValue={row?.lastSale ?? undefined}
                min={0}
                name="lastSale"
                placeholder={t("assortmentModal.salePlaceholder")}
                type="number"
              />
            </label>
          </div>

          <label>
            {t("assortmentModal.checkedDate")}
            <input
              defaultValue={row?.lastCheckedAt?.slice(0, 10) ?? undefined}
              name="lastCheckedAt"
              type="date"
            />
          </label>

          <label>
            {t("assortmentModal.comment")}
            <textarea
              defaultValue={row?.comment ?? undefined}
              name="comment"
              placeholder={t("assortmentModal.commentPlaceholder")}
              rows={3}
            />
          </label>

          <PendingSubmitButton
            className="primary-button location-potential-submit"
            disabled={mode === "add" && !selectedId}
            pendingLabel={tCommon("saving")}
          >
            {mode === "add" ? t("assortmentModal.submit") : tCommon("save")}
          </PendingSubmitButton>
        </form>
      </dialog>
    </>
  );
}
