import { useFormatter, useTranslations } from "next-intl";

import type { LocationPotential } from "../lib/api-client";
import { formatDate } from "../lib/format";
import { INPUT_LIMITS } from "../lib/input-limits";
import type { LocationKeeper } from "../lib/location-keeper";
import { BanknoteIcon, TrashIcon } from "./icons";
import { LocationPotentialModal } from "./location-potential-modal";
import { PendingSubmitButton } from "./pending-submit-button";

type LocationPotentialPanelProps = {
  rows: LocationPotential[];
  availableCategories: { id: string; name: string }[];
  canManage: boolean;
  // Only read when canManage is true — read-only callers (the admin location
  // detail screen) omit them.
  upsertAction?: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
  // "inline" (default) renders rows read-only (admin, canManage=false) or as
  // editable forms when canManage; "cards" renders collapsible display cards
  // with a per-row edit modal (pencil) and delete (trash) — the field screen
  // uses this and drives adds from its own header "+" modal. locationName feeds
  // the edit modal's subtitle and is only read in "cards" mode.
  variant?: "inline" | "cards";
  locationName?: string;
  // Who keeps this location's record, when the caller knows. Only read to
  // word the "cards" empty state for a reader who cannot write; the header
  // pill on the same screen states the same fact.
  keeper?: LocationKeeper;
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
  variant = "inline",
  locationName = "",
  keeper,
}: LocationPotentialPanelProps) {
  const t = useTranslations("common.locationInsights");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const showInlineAddForm =
    variant === "inline" && canManage && availableCategories.length > 0;

  const money = (value: number | null) =>
    value == null ? "—" : `${format.number(value)} ${t("currency")}`;

  return (
    <div className="field-card-list">
      {rows.length === 0 ? (
        variant === "cards" ? (
          <div className="empty-state-panel location-insights-empty">
            <span className="location-insights-empty-icon" aria-hidden="true">
              <BanknoteIcon size={28} />
            </span>
            <h2>{t("potentialEmptyTitle")}</h2>
            {/* The title states a fact either way; only the hint may invite,
                and a reader without an assignment here has no "+" to answer
                it with. On a location nobody keeps there is also no assigned
                representative to point at, so that case names the manager who
                closes the gap instead of a person who does not exist. */}
            <p>
              {canManage
                ? t("potentialEmptyHint")
                : keeper?.kind === "unassigned"
                  ? t("potentialEmptyUnassignedHint")
                  : t("potentialEmptyReadOnlyHint")}
            </p>
          </div>
        ) : (
          <p className="empty-state">{t("potentialEmpty")}</p>
        )
      ) : null}

      {rows.map((row) =>
        variant === "cards" ? (
          <div className="location-insight-card" key={row.id}>
            <div className="location-insight-card-summary">
              <h3>{row.productCategory.name}</h3>
              {canManage && upsertAction && deleteAction ? (
                <div className="location-insight-card-actions">
                  <LocationPotentialModal
                    action={upsertAction}
                    canManage={canManage}
                    locationName={locationName}
                    mode="edit"
                    row={row}
                  />
                  <form action={deleteAction}>
                    <input
                      name="productCategoryId"
                      type="hidden"
                      value={row.productCategoryId}
                    />
                    <PendingSubmitButton
                      aria-label={t("remove")}
                      className="location-insight-action location-insight-action--danger"
                      pendingLabel="…"
                    >
                      <TrashIcon />
                    </PendingSubmitButton>
                  </form>
                </div>
              ) : null}
            </div>
            <div className="location-insight-card-body">
              <div className="location-insight-summary-row">
                <p
                  aria-label={t("readAmount", {
                    amount: money(row.potentialAmount),
                  })}
                  className="location-potential-meta"
                >
                  <span
                    className="location-potential-meta-icon"
                    aria-hidden="true"
                  >
                    <BanknoteIcon />
                  </span>
                  {money(row.potentialAmount)}
                </p>
                {row.potentialDate ? (
                  <span
                    aria-label={t("readDate", {
                      date: formatDate(format, row.potentialDate),
                    })}
                    className="location-insight-pill"
                  >
                    {formatDate(format, row.potentialDate)}
                  </span>
                ) : null}
              </div>
              <div className="location-insight-tiles">
                {[
                  {
                    key: "month1",
                    label: t("potentialModal.month1"),
                    value: row.planMonth1,
                  },
                  {
                    key: "month2",
                    label: t("potentialModal.month2"),
                    value: row.planMonth2,
                  },
                  {
                    key: "month3",
                    label: t("potentialModal.month3"),
                    value: row.planMonth3,
                  },
                ].map((month) => (
                  <div className="location-insight-tile" key={month.key}>
                    <span className="location-insight-tile-label">
                      {month.label}
                    </span>
                    <span className="location-insight-tile-value">
                      {money(month.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
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
                    maxLength={INPUT_LIMITS.comment}
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
        ),
      )}

      {showInlineAddForm ? (
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
