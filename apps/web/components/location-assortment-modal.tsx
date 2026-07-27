"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type { LocationAssortment } from "../lib/api-client";
import { INPUT_LIMITS } from "../lib/input-limits";
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

const PRODUCT_LIMIT = 50;

function productLabel(name: string, sku: string | null): string {
  return sku ? `${name} · ${sku}` : name;
}

// Add-to-matrix / edit dialog for one assortment row. The manager answers one
// question here — should this outlet carry this product — so the form is a
// product plus the matrix flag and nothing else: shelf state (in stock or not,
// when it was last checked) is written by visit reports, and a manager sitting
// in an office cannot know it. Adding uses a searchable, keyboard-operable
// product picker (a location can list hundreds of SKUs, so a plain <select> is
// unworkable); editing locks the product (it is the upsert key). The matrix
// flag is an interactive two-option switch (required / not required) backed by
// `matrixRequired`; when required, a hidden shouldBeListed field is submitted.
// The <dialog> is portaled to the document body so it is never a DOM
// descendant of a <summary> (clicks inside a top-layer dialog would otherwise
// bubble through and toggle the section).
export function LocationAssortmentModal(props: LocationAssortmentModalProps) {
  const { action, canManage, locationName, mode } = props;
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const listId = useId();

  const products = props.mode === "add" ? props.availableProducts : [];
  const initialMatrixRequired =
    props.mode === "add" ? true : Boolean(props.row.shouldBeListed);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [matrixRequired, setMatrixRequired] = useState(initialMatrixRequired);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const { filtered, totalMatches } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? products.filter((product) =>
          productLabel(product.name, product.sku)
            .toLowerCase()
            .includes(needle),
        )
      : products;
    return {
      filtered: base.slice(0, PRODUCT_LIMIT),
      totalMatches: base.length,
    };
  }, [products, query]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (open && activeIndex >= 0) {
      document
        .getElementById(`${listId}-opt-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open, listId]);

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

  function resetForm() {
    formRef.current?.reset();
    setQuery("");
    setSelectedId("");
    setOpen(false);
    setActiveIndex(-1);
    setMatrixRequired(initialMatrixRequired);
  }

  function closeWithReset() {
    resetForm();
    dialogRef.current?.close();
  }

  function selectProduct(product: ProductOption) {
    setSelectedId(product.id);
    setQuery(productLabel(product.name, product.sku));
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const option = filtered[activeIndex];
      if (open && option) {
        event.preventDefault();
        selectProduct(option);
      }
    } else if (event.key === "Escape" && open) {
      // Close the list, not the whole dialog.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeOptionId =
    open && activeIndex >= 0 && filtered[activeIndex]
      ? `${listId}-opt-${activeIndex}`
      : undefined;

  const trigger =
    mode === "add" ? (
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
        className="location-insight-action"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        <PencilIcon />
      </button>
    );

  const dialog = (
    <dialog
      aria-labelledby={titleId}
      className="modal-dialog"
      onCancel={resetForm}
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
          onClick={closeWithReset}
          type="button"
        >
          ×
        </button>
      </div>

      <form
        action={action}
        className="visit-form compact modal-form"
        onSubmit={() => {
          // Defer to a macrotask so React captures the FormData for the server
          // action first, then close explicitly — relying on a post-redirect
          // remount to close the dialog is not guaranteed. Conscious trade-off:
          // closing here means the button's "saving" state isn't shown; the
          // redirect (fast) surfaces the inline "saved" confirmation instead.
          window.setTimeout(() => {
            dialogRef.current?.close();
            resetForm();
          }, 0);
        }}
        ref={formRef}
      >
        {props.mode === "add" ? (
          <label className="product-picker-label">
            <span>
              {t("assortmentModal.product")}{" "}
              <span aria-hidden="true" className="field-required">
                *
              </span>
            </span>
            <div
              className="product-picker"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setOpen(false);
                  setActiveIndex(-1);
                }
              }}
            >
              <span className="product-picker-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded={open}
                autoComplete="off"
                className="product-picker-input"
                maxLength={INPUT_LIMITS.search}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId("");
                  setActiveIndex(-1);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={t("assortmentModal.productPlaceholder")}
                role="combobox"
                type="text"
                value={query}
              />
              <span className="product-picker-chevron" aria-hidden="true">
                ›
              </span>
              {open ? (
                <ul
                  aria-label={t("assortmentModal.product")}
                  className="product-picker-list"
                  id={listId}
                  role="listbox"
                >
                  {filtered.length > 0 ? (
                    filtered.map((product, index) => (
                      <li
                        aria-selected={index === activeIndex}
                        className={`product-picker-option${
                          index === activeIndex ? " is-active" : ""
                        }`}
                        id={`${listId}-opt-${index}`}
                        key={product.id}
                        onClick={() => selectProduct(product)}
                        onMouseDown={(event) => event.preventDefault()}
                        role="option"
                      >
                        {productLabel(product.name, product.sku)}
                      </li>
                    ))
                  ) : (
                    <li className="product-picker-empty">
                      {t("assortmentModal.productEmpty")}
                    </li>
                  )}
                  {totalMatches > filtered.length ? (
                    <li className="product-picker-hint">
                      {t("assortmentModal.productMore", {
                        count: PRODUCT_LIMIT,
                      })}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <input name="productId" type="hidden" value={selectedId} />
          </label>
        ) : (
          <div className="modal-static-field">
            <input name="productId" type="hidden" value={props.row.productId} />
            <span className="modal-static-label">
              {t("assortmentModal.product")}
            </span>
            <span className="modal-static-value">
              {productLabel(props.row.product.name, props.row.product.sku)}
            </span>
          </div>
        )}

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

        <p className="form-hint">{t("assortmentModal.shelfStateHint")}</p>

        <PendingSubmitButton
          className="primary-button location-potential-submit"
          disabled={mode === "add" && !selectedId}
          pendingLabel={tCommon("saving")}
        >
          {mode === "add" ? t("assortmentModal.submit") : tCommon("save")}
        </PendingSubmitButton>
      </form>
    </dialog>
  );

  return (
    <>
      {trigger}
      {mounted ? createPortal(dialog, document.body) : null}
    </>
  );
}
