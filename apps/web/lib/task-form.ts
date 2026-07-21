import type { Location, RoutePlan, Task, Visit } from "./api-client";
import type { FilterOption } from "./filter-options";

// What the assign-task form needs on the server, shared by the manager overview
// and the task list so both offer the same choices and read the same input.

// There is no "list my representatives" endpoint, so the assignable people are
// whoever the manager can already see acting in the tenant: on a route, on a
// visit, or holding a task.
export function buildTaskAssigneeOptions(
  routes: RoutePlan[],
  visits: Visit[],
  tasks: Task[],
  locale: string,
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  routes.forEach((route) => {
    options.set(route.representative.id, {
      id: route.representative.id,
      label: route.representative.name,
    });
  });
  visits.forEach((visit) => {
    options.set(visit.representative.id, {
      id: visit.representative.id,
      label: visit.representative.name,
    });
  });
  tasks.forEach((task) => {
    if (task.assignedTo) {
      options.set(task.assignedTo.id, {
        id: task.assignedTo.id,
        label: task.assignedTo.name,
      });
    }
  });

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

// Callers pass the active locations; route and visit locations are added on top
// so a place that is already on today's plan stays linkable.
export function buildTaskLocationOptions(
  routes: RoutePlan[],
  visits: Visit[],
  locations: Location[],
  locale: string,
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  routes.forEach((route) => {
    route.items.forEach((item) => {
      options.set(item.location.id, {
        id: item.location.id,
        label: item.location.name,
      });
    });
  });
  visits.forEach((visit) => {
    options.set(visit.location.id, {
      id: visit.location.id,
      label: visit.location.name,
    });
  });
  locations.forEach((location) => {
    options.set(location.id, {
      id: location.id,
      label: location.name,
    });
  });

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

export function parseTaskIsPriorityInput(
  value: FormDataEntryValue | null,
): boolean {
  return value === "true";
}
