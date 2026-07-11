"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import type { Chain } from "../lib/api-client";
import { PendingSubmitButton } from "./pending-submit-button";

type CreateLocationModalProps = {
  action: (formData: FormData) => Promise<void>;
  chains: Chain[];
};

export function CreateLocationModal({
  action,
  chains,
}: CreateLocationModalProps) {
  const t = useTranslations("admin.locations");
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button"
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {t("addLocation")}
      </button>

      <dialog
        aria-labelledby="create-location-title"
        className="modal-dialog"
        ref={dialogRef}
      >
        <div className="modal-header">
          <div>
            <h2 id="create-location-title">{t("addLocation")}</h2>
            <p className="small-label">{t("createLocationBody")}</p>
          </div>
          <button
            aria-label={t("cancel")}
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>

        <form action={action} className="visit-form compact modal-form">
          <label>
            {t("number")}
            <input name="externalCode" />
          </label>
          <label>
            {t("name")}
            <input name="name" required />
          </label>
          <label>
            {t("address")}
            <input name="addressLine" required />
          </label>
          <label>
            {t("city")}
            <input name="city" required />
          </label>
          <label>
            {t("chain")}
            <select defaultValue="" name="chainId">
              <option value="">{t("chainNone")}</option>
              {chains.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("region")}
            <input name="region" />
          </label>
          <label>
            {t("category")}
            <input name="type" />
          </label>
          <label>
            {t("notes")}
            <textarea name="notes" rows={3} />
          </label>

          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              {t("cancel")}
            </button>
            <PendingSubmitButton
              className="primary-button"
              pendingLabel={t("creating")}
            >
              {t("createLocation")}
            </PendingSubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
