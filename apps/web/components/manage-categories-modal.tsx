"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import type { ProductCategory } from "../lib/api-client";
import { PendingSubmitButton } from "./pending-submit-button";

type ManageCategoriesModalProps = {
  categories: ProductCategory[];
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function ManageCategoriesModal({
  categories,
  createAction,
  deleteAction,
}: ManageCategoriesModalProps) {
  const t = useTranslations("admin.products");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="secondary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("categories")}
      </button>

      <dialog
        aria-labelledby="manage-categories-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="manage-categories-title">{t("categoriesTitle")}</h2>
            <p className="small-label">{t("categoriesBody")}</p>
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

        <form action={createAction} className="visit-form compact modal-form">
          <label>
            {t("categoryName")}
            <input
              name="name"
              placeholder={t("categoryNamePlaceholder")}
              required
            />
          </label>
          <div className="modal-actions">
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={tCommon("saving")}
            >
              {t("addCategory")}
            </PendingSubmitButton>
          </div>
        </form>

        <div className="category-list">
          <p className="small-label">
            {t("categoriesCount", { count: categories.length })}
          </p>
          {categories.length > 0 ? (
            <ul className="category-items">
              {categories.map((category) => (
                <li key={category.id} className="category-item">
                  <span>{category.name}</span>
                  <form action={deleteAction}>
                    <input
                      name="categoryId"
                      type="hidden"
                      value={category.id}
                    />
                    <PendingSubmitButton
                      className="secondary-button danger"
                      pendingLabel={t("deletingCategory")}
                    >
                      {t("deleteCategory")}
                    </PendingSubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-hint">{t("categoriesEmpty")}</p>
          )}
        </div>
      </dialog>
    </>
  );
}
