"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { ChainStatus } from "../lib/api-client";

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
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // Archiving redirects and RSC-refreshes without remounting, so the confirm
  // prompt would otherwise linger over an already-archived chain. Close it
  // whenever the incoming status changes.
  useEffect(() => {
    setConfirming(false);
  }, [chainStatus]);

  function archive() {
    const formData = new FormData();
    formData.set("chainId", chainId);
    startTransition(() => {
      void archiveAction(formData);
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
          {t("archiveChain")}
        </button>
      </div>
    );
  }

  return (
    <div className="product-delete confirming">
      <span className="product-delete-prompt">
        {t("archiveChainPrompt", { name: chainName })}
      </span>
      <div className="product-delete-actions">
        <button
          className="secondary-button danger"
          disabled={pending}
          onClick={archive}
          type="button"
        >
          {pending ? t("archivingChain") : t("archiveChain")}
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
