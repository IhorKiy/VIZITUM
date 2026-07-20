import { useTranslations } from "next-intl";

import type { LocationPotential } from "../lib/api-client";
import { PendingSubmitButton } from "./pending-submit-button";

type LocationPotentialPanelProps = {
  rows: LocationPotential[];
  availableCategories: { id: string; name: string }[];
  canManage: boolean;
  upsertAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

// Shared by the field location detail screen and the admin location detail
// screen — both render this inside their own <details class="location-feature">
// chrome, so this only owns the body: empty state, existing rows, and (when
// canManage) the add-row form. Add and edit submit the same upsertAction; the
// only difference is whether productCategoryId comes from a hidden input
// (edit) or the picker <select> (add).
export function LocationPotentialPanel({
  rows,
  availableCategories,
  canManage,
  upsertAction,
  deleteAction,
}: LocationPotentialPanelProps) {
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");

  if (rows.length === 0 && (!canManage || availableCategories.length === 0)) {
    return <p className="empty-state">{t("potentialEmpty")}</p>;
  }

  return (
    <div className="field-card-list">
      {rows.map((row) => (
        <article className="location-mini-card" key={row.id}>
          {canManage ? (
            <form action={upsertAction} className="visit-form compact">
              <input
                name="productCategoryId"
                type="hidden"
                value={row.productCategoryId}
              />
              <h3 className="visit-form-full">{row.productCategory.name}</h3>
              <label>
                {t("potentialAmount")}
                <input
                  defaultValue={row.potentialAmount ?? ""}
                  min={0}
                  name="potentialAmount"
                  type="number"
                />
              </label>
              <label>
                {t("potentialDate")}
                <input
                  defaultValue={row.potentialDate ?? ""}
                  name="potentialDate"
                  type="date"
                />
              </label>
              <label>
                {t("planMonth1")}
                <input
                  defaultValue={row.planMonth1 ?? ""}
                  min={0}
                  name="planMonth1"
                  type="number"
                />
              </label>
              <label>
                {t("planMonth2")}
                <input
                  defaultValue={row.planMonth2 ?? ""}
                  min={0}
                  name="planMonth2"
                  type="number"
                />
              </label>
              <label>
                {t("planMonth3")}
                <input
                  defaultValue={row.planMonth3 ?? ""}
                  min={0}
                  name="planMonth3"
                  type="number"
                />
              </label>
              <label className="visit-form-full">
                {t("comment")}
                <textarea
                  defaultValue={row.comment ?? ""}
                  name="comment"
                  rows={2}
                />
              </label>
              <PendingSubmitButton
                className="secondary-button"
                pendingLabel={tCommon("saving")}
              >
                {tCommon("save")}
              </PendingSubmitButton>
            </form>
          ) : (
            <header>
              <div>
                <h3>{row.productCategory.name}</h3>
                <p>
                  {t("potentialAmount")}:{" "}
                  {row.potentialAmount ?? tCommon("notSet")}
                </p>
              </div>
            </header>
          )}
          {canManage ? (
            <form action={deleteAction}>
              <input
                name="productCategoryId"
                type="hidden"
                value={row.productCategoryId}
              />
              <PendingSubmitButton
                className="secondary-button danger"
                pendingLabel={tCommon("saving")}
              >
                {t("remove")}
              </PendingSubmitButton>
            </form>
          ) : null}
        </article>
      ))}

      {canManage && availableCategories.length > 0 ? (
        <form action={upsertAction} className="visit-form compact">
          <label className="visit-form-full">
            {t("category")}
            <select defaultValue="" name="productCategoryId" required>
              <option disabled value="">
                {t("selectCategory")}
              </option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("potentialAmount")}
            <input min={0} name="potentialAmount" type="number" />
          </label>
          <PendingSubmitButton
            className="secondary-button"
            pendingLabel={tCommon("saving")}
          >
            {t("addCategory")}
          </PendingSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
