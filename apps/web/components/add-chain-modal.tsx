"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import { INPUT_LIMITS } from "../lib/input-limits";
import { PendingSubmitButton } from "./pending-submit-button";

type AddChainModalProps = {
  action: (formData: FormData) => Promise<void>;
};

export function AddChainModal({ action }: AddChainModalProps) {
  const t = useTranslations("admin.chains");
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
        {t("createChain")}
      </button>

      <dialog
        aria-labelledby="add-chain-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="add-chain-title">{t("createTitle")}</h2>
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
            <input maxLength={INPUT_LIMITS.name} name="name" required />
          </label>
          <label>
            {t("externalCode")}
            <input maxLength={INPUT_LIMITS.code} name="externalCode" />
          </label>
          <label>
            {t("notes")}
            <input maxLength={INPUT_LIMITS.notes} name="notes" />
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
              {t("createChain")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
