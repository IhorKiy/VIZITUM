"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

type DeleteProductButtonProps = {
  productId: string;
  productName: string;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function DeleteProductButton({
  productId,
  productName,
  deleteAction,
}: DeleteProductButtonProps) {
  const t = useTranslations("admin.products");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    const formData = new FormData();
    formData.set("productId", productId);
    startTransition(() => {
      void deleteAction(formData);
    });
  }

  if (!confirming) {
    return (
      <div className="product-delete">
        <button
          className="secondary-button danger"
          onClick={() => setConfirming(true)}
          type="button"
        >
          {t("deleteProduct")}
        </button>
      </div>
    );
  }

  return (
    <div className="product-delete confirming">
      <span className="product-delete-prompt">
        {t("deleteProductPrompt", { name: productName })}
      </span>
      <div className="product-delete-actions">
        <button
          className="secondary-button danger"
          disabled={pending}
          onClick={remove}
          type="button"
        >
          {pending ? t("deletingProduct") : t("deleteProduct")}
        </button>
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
        >
          {t("cancelEdit")}
        </button>
      </div>
    </div>
  );
}
