"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import type { ProductCategory } from "../lib/api-client";
import { PendingSubmitButton } from "./pending-submit-button";

type AddProductModalProps = {
  action: (formData: FormData) => Promise<void>;
  categories: ProductCategory[];
};

export function AddProductModal({ action, categories }: AddProductModalProps) {
  const t = useTranslations("admin.products");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("addProduct")}
      </button>

      <dialog
        aria-labelledby="add-product-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="add-product-title">{t("addProduct")}</h2>
            <p className="small-label">{t("addProductBody")}</p>
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
          <label>
            {t("name")}
            <input name="name" placeholder={t("namePlaceholder")} required />
          </label>
          <label>
            {t("sku")}
            <input name="sku" placeholder={t("skuPlaceholder")} />
          </label>
          <label>
            {t("category")}
            <select defaultValue="" name="category">
              <option value="">{t("noCategoryOption")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-inline">
            <input name="notApplicable" type="checkbox" />
            <span>{t("notApplicableCheckbox")}</span>
          </label>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              {tCommon("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={tCommon("saving")}
            >
              {t("addProduct")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
