import type { TaskStatus } from "./api-client";

// Single source of truth for task statuses and their pill tone, shared by the
// tasks page (table + filters) and the inline status editor so a new status
// only has to be added in one place.
export const taskStatuses: TaskStatus[] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

export function taskStatusTone(
  status: TaskStatus,
): "active" | "info" | "warning" {
  if (status === "done") {
    return "active";
  }

  if (status === "cancelled") {
    return "warning";
  }

  return "info";
}
