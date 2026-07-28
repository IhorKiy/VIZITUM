import type { LocationAssignment } from "./api-client";

// Who keeps a location's written record — the potential, the notes and the
// contacts, all three gated on an active LocationAssignment. Not who may work
// the outlet: visits, routes and tasks carry no assignment check at all.
//
// "unassigned" is a state of its own, not a missing value: nobody keeps the
// record, so a screen must not point the reader at a representative who does
// not exist, and it is a gap a manager closes by assigning someone.
export type LocationKeeper =
  // No session to compare against, so "mine" cannot be decided.
  | { kind: "unknown" }
  | { kind: "mine" }
  | { kind: "others"; name: string; othersCount: number }
  | { kind: "unassigned" };

export function resolveLocationKeeper(
  assignments: LocationAssignment[],
  currentUserId: string | null,
): LocationKeeper {
  if (!currentUserId) {
    return { kind: "unknown" };
  }

  // Defensive, not corrective: every LocationResponse builds `assignments`
  // from an include that already filters to active ones, so this only keeps
  // the rule local if some other caller ever hands over a raw list.
  const active = assignments.filter(
    (assignment) => assignment.status === "active",
  );

  if (
    active.some(
      (assignment) => assignment.representativeUserId === currentUserId,
    )
  ) {
    return { kind: "mine" };
  }

  const [first, ...others] = active;

  if (!first) {
    return { kind: "unassigned" };
  }

  return {
    kind: "others",
    name: first.representative.name,
    othersCount: others.length,
  };
}
