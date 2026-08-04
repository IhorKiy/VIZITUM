"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { CheckIcon, CloseIcon, PencilIcon } from "./icons";
import { PendingSubmitButton } from "./pending-submit-button";

type CategoryLike = { id: string; name: string };

// Message namespaces wired to this accordion; each must provide the same
// category-management key set (categoriesTitle, categoryName, addCategory,
// cancelEdit, editCategory, deleteCategory, deletingCategory, ...). Add a
// namespace here when a new screen adopts the accordion.
type CategoriesNamespace = "admin.products" | "admin.locations";

type CategoriesAccordionProps = {
  categories: CategoryLike[];
  createAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  namespace: CategoriesNamespace;
  defaultOpen?: boolean;
};

export function CategoriesAccordion({
  categories,
  createAction,
  updateAction,
  deleteAction,
  namespace,
  defaultOpen = false,
}: CategoriesAccordionProps) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const [adding, setAdding] = useState(false);
  // A category action redirects the whole page, which would reset an
  // uncontrolled <details>. Control the open state so the panel stays open
  // after adding/renaming/removing a category.
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      className="panel panel-collapsible category-accordion"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary className="panel-summary">
        <div className="panel-title-stack">
          <h2>{t("categoriesTitle")}</h2>
          <p>{t("categoriesCount", { count: categories.length })}</p>
        </div>
      </summary>

      <div className="category-accordion-body">
        {adding ? (
          <form action={createAction} className="category-add-form">
            <label>
              {t("categoryName")}
              <input
                autoFocus
                maxLength={INPUT_LIMITS.name}
                name="name"
                placeholder={t("categoryNamePlaceholder")}
                required
              />
            </label>
            <PendingSubmitButton
              className="secondary-button"
              pendingLabel={tCommon("saving")}
            >
              {t("addCategory")}
            </PendingSubmitButton>
            <button
              className="secondary-button"
              onClick={() => setAdding(false)}
              type="button"
            >
              {t("cancelEdit")}
            </button>
          </form>
        ) : (
          <button
            className="secondary-button category-add-toggle"
            onClick={() => setAdding(true)}
            type="button"
          >
            {t("addCategory")}
          </button>
        )}

        {categories.length > 0 ? (
          <ul className="category-items">
            {categories.map((category) => (
              <CategoryRow
                category={category}
                deleteAction={deleteAction}
                key={category.id}
                namespace={namespace}
                updateAction={updateAction}
              />
            ))}
          </ul>
        ) : (
          <p className="empty-hint">{t("categoriesEmpty")}</p>
        )}
      </div>
    </details>
  );
}

function CategoryRow({
  category,
  updateAction,
  deleteAction,
  namespace,
}: {
  category: CategoryLike;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
  namespace: CategoriesNamespace;
}) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // A successful rename redirects and RSC-refreshes without remounting, so
  // close the editor whenever the incoming name changes. Adjusted during
  // render (React's documented pattern for resetting state when a prop
  // changes) rather than in an effect, so there is no extra render showing
  // the stale editing state.
  const [prevName, setPrevName] = useState(category.name);
  if (category.name !== prevName) {
    setPrevName(category.name);
    setEditing(false);
  }

  function save() {
    const value = inputRef.current?.value.trim() ?? "";

    if (!value || value === category.name) {
      setEditing(false);
      return;
    }

    const formData = new FormData();
    formData.set("categoryId", category.id);
    formData.set("name", value);
    startTransition(() => {
      void updateAction(formData);
    });
  }

  if (editing) {
    return (
      <li className="category-item">
        <div className="category-edit">
          <input
            aria-label={t("categoryName")}
            defaultValue={category.name}
            disabled={pending}
            maxLength={INPUT_LIMITS.name}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
            ref={inputRef}
          />
          <button
            aria-label={tCommon("save")}
            className="name-edit-button"
            disabled={pending}
            onClick={save}
            title={tCommon("save")}
            type="button"
          >
            <CheckIcon />
          </button>
          <button
            aria-label={t("cancelEdit")}
            className="name-edit-button"
            disabled={pending}
            onClick={() => setEditing(false)}
            title={t("cancelEdit")}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="category-item">
      <span className="category-name">{category.name}</span>
      <div className="category-actions">
        <button
          aria-label={t("editCategory")}
          className="name-edit-button"
          onClick={() => setEditing(true)}
          title={t("editCategory")}
          type="button"
        >
          <PencilIcon />
        </button>
        <form action={deleteAction}>
          <input name="categoryId" type="hidden" value={category.id} />
          <PendingSubmitButton
            className="secondary-button danger"
            pendingLabel={t("deletingCategory")}
          >
            {t("deleteCategory")}
          </PendingSubmitButton>
        </form>
      </div>
    </li>
  );
}
