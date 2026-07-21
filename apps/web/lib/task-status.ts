import type { TaskStatus } from "./api-client";
import { statusPillTone } from "./format";

// Single source of truth for task statuses and their pill tone, shared by the
// tasks page (table + filters) and the inline status editor so a new status
// only has to be added in one place.
export const taskStatuses: TaskStatus[] = ["in_progress", "done"];

// Defers to the shared status tone rather than repeating the mapping: the two
// had drifted into colouring "open" and "in_progress" alike.
export function taskStatusTone(status: TaskStatus) {
  return statusPillTone(status);
}

// The one predicate every "open work" counter across manager/field
// dashboards, per-rep and per-location activity needs — kept here so a
// future status never has to be reconciled across half a dozen call sites
// again the way "open"/"in_progress"/"cancelled" once had to be.
export function isTaskUnfinished(status: TaskStatus): boolean {
  return status !== "done";
}
