import type { TaskStatus } from "./api-client";

// Single source of truth for task statuses and their pill tone, shared by the
// tasks page (table + filters), the inline status editor and the field
// location task list so a new status only has to be added in one place.
export const taskStatuses: TaskStatus[] = ["in_progress", "done"];

// Task pills carry their own tone mapping rather than deferring to
// statusPillTone: that shared mapping colours done with the brand accent
// ("active") and would give in_progress the info tone, but here the
// emphasis is reversed. in_progress is the work actively moving, so it takes
// the accent to draw the eye; done recedes to the quiet neutral tone. The two
// TaskStatus values are handled exhaustively — there is no third state to fall
// through to.
export function taskStatusTone(status: TaskStatus): "active" | "neutral" {
  return status === "in_progress" ? "active" : "neutral";
}

// The one predicate every "open work" counter across manager/field
// dashboards, per-rep and per-location activity needs — kept here so a
// future status never has to be reconciled across half a dozen call sites
// again the way "open"/"in_progress"/"cancelled" once had to be.
export function isTaskUnfinished(status: TaskStatus): boolean {
  return status !== "done";
}
