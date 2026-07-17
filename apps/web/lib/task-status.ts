import type { TaskStatus } from "./api-client";
import { statusPillTone } from "./format";

// Single source of truth for task statuses and their pill tone, shared by the
// tasks page (table + filters) and the inline status editor so a new status
// only has to be added in one place.
export const taskStatuses: TaskStatus[] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

// Defers to the shared status tone rather than repeating the mapping: the two
// had drifted into colouring "open" and "in_progress" alike.
export function taskStatusTone(status: TaskStatus) {
  return statusPillTone(status);
}
