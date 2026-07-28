import { useTranslations } from "next-intl";

import type { LocationKeeper } from "../lib/location-keeper";

type LocationAssignmentPillProps = {
  keeper: LocationKeeper;
};

// Marks the exception, not the rule: the location the reader is assigned to
// carries no pill, since that is the ordinary case on these screens and a
// badge on every one of them would say nothing.
//
// The wording names who keeps the record rather than denying access, because
// assignment governs writes only — see resolveLocationKeeper, which owns the
// decision and is tested separately.
export function LocationAssignmentPill({
  keeper,
}: LocationAssignmentPillProps) {
  const t = useTranslations("common.locationAssignment");

  // Without a session there is no "mine" to compare against, so naming a
  // colleague would be the one case where this pill is pure noise.
  if (keeper.kind === "unknown" || keeper.kind === "mine") {
    return null;
  }

  if (keeper.kind === "unassigned") {
    return <span className="location-insight-pill">{t("unassigned")}</span>;
  }

  return (
    <span className="location-insight-pill">
      {keeper.othersCount > 0
        ? t("keptByOthers", {
            name: keeper.name,
            count: keeper.othersCount,
          })
        : t("keptBy", { name: keeper.name })}
    </span>
  );
}
