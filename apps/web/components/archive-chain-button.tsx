"use client";

import { useTranslations } from "next-intl";

import type { ChainStatus } from "../lib/api-client";
import { ConfirmActionButton } from "./confirm-action-button";

type ArchiveChainButtonProps = {
  chainId: string;
  chainName: string;
  chainStatus: ChainStatus;
  archiveAction: (formData: FormData) => Promise<void>;
};

export function ArchiveChainButton({
  chainId,
  chainName,
  chainStatus,
  archiveAction,
}: ArchiveChainButtonProps) {
  const t = useTranslations("admin.chains");

  return (
    <ConfirmActionButton
      action={archiveAction}
      cancelLabel={t("cancelEdit")}
      confirmLabel={t("archiveChain")}
      fieldName="chainId"
      id={chainId}
      pendingLabel={t("archivingChain")}
      promptText={t("archiveChainPrompt", { name: chainName })}
      renderTrigger={({ onClick, ref }) => (
        <button
          className="secondary-button danger"
          onClick={onClick}
          ref={ref}
          type="button"
        >
          {t("archiveChain")}
        </button>
      )}
      resetKey={chainStatus}
    />
  );
}
