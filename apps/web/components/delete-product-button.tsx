"use client";

import { useTranslations } from "next-intl";

import { ConfirmActionButton } from "./confirm-action-button";

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

  return (
    <ConfirmActionButton
      action={deleteAction}
      cancelLabel={t("cancelEdit")}
      confirmLabel={t("deleteProduct")}
      fieldName="productId"
      id={productId}
      pendingLabel={t("deletingProduct")}
      promptText={t("deleteProductPrompt", { name: productName })}
      renderTrigger={({ onClick, ref }) => (
        <button
          className="secondary-button danger"
          onClick={onClick}
          ref={ref}
          type="button"
        >
          {t("deleteProduct")}
        </button>
      )}
    />
  );
}
