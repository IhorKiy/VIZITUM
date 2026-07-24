"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

import type { Chain, LocationCategory, TenantUser } from "../lib/api-client";
import { INPUT_LIMITS } from "../lib/input-limits";
import { PendingSubmitButton } from "./pending-submit-button";

type CreateLocationModalProps = {
  action: (formData: FormData) => Promise<void>;
  categories: LocationCategory[];
  chains: Chain[];
  locationCategoriesEnabled: boolean;
  representatives: TenantUser[];
};

export function CreateLocationModal({
  action,
  categories,
  chains,
  locationCategoriesEnabled,
  representatives,
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

        <form
          action={action}
          className="visit-form compact modal-form visit-form-2col"
        >
          <label>
            {t("number")}
            <input maxLength={INPUT_LIMITS.code} name="externalCode" />
          </label>
          <label>
            {t("name")}
            <input maxLength={INPUT_LIMITS.name} name="name" required />
          </label>
          <label>
            {t("address")}
            <input
              maxLength={INPUT_LIMITS.addressLine}
              name="addressLine"
              required
            />
          </label>
          <label>
            {t("city")}
            <input maxLength={INPUT_LIMITS.city} name="city" required />
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
          {locationCategoriesEnabled ? (
            <label>
              {t("category")}
              <select defaultValue="" name="categoryId">
                <option value="">{t("noCategoryOption")}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            {t("assignedUser")}
            <select defaultValue="" name="representativeUserId">
              <option value="">{t("notAssigned")}</option>
              {representatives.map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.name}
                </option>
              ))}
            </select>
          </label>
          <label className="visit-form-full">
            {t("notes")}
            <textarea maxLength={INPUT_LIMITS.notes} name="notes" rows={3} />
          </label>

          <div className="modal-actions visit-form-full">
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
