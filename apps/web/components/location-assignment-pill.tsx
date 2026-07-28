import { useTranslations } from "next-intl";

import type { LocationAssignment } from "../lib/api-client";

type LocationAssignmentPillProps = {
  assignments: LocationAssignment[];
  currentUserId: string | null;
};

// Marks the exception, not the rule: the location the reader is assigned to
// carries no pill, since that is the ordinary case on these screens and a
// badge on every one of them would say nothing.
//
// Derived from the assignments the location response already carries, never
// from an insights `canManage`: that flag collapses three different causes
// (no assignment, a role without the own-scope permission, no session) and
// would turn a guess into a statement about a named colleague.
//
// The wording names who keeps the record rather than denying access, because
// assignment governs writes only — the potential, notes and contacts. Visits,
// routes and tasks carry no assignment check at all, so a rep may legitimately
// work an outlet that someone else keeps, and "not yours" would read as a
// prohibition that does not exist.
export function LocationAssignmentPill({
  assignments,
  currentUserId,
}: LocationAssignmentPillProps) {
  const t = useTranslations("common.locationAssignment");

  // Without a session there is no "mine" to compare against, so naming a
  // colleague would be the one case where this pill is pure noise.
  if (!currentUserId) {
    return null;
  }

  const active = assignments.filter(
    (assignment) => assignment.status === "active",
  );

  if (
    active.some(
      (assignment) => assignment.representativeUserId === currentUserId,
    )
  ) {
    return null;
  }

  // A location nobody keeps is worth its own word: the empty potential there
  // has no assigned representative to wait for, and it is a gap a manager
  // closes by assigning someone.
  if (active.length === 0) {
    return <span className="location-insight-pill">{t("unassigned")}</span>;
  }

  const [first, ...others] = active;
  const name = first.representative.name || first.representative.email;

  return (
    <span className="location-insight-pill">
      {others.length > 0
        ? t("keptByOthers", { name, count: others.length })
        : t("keptBy", { name })}
    </span>
  );
}
