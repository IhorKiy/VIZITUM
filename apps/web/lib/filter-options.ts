import type { Location, RoutePlan } from "./api-client";

export type FilterOption = {
  id: string;
  label: string;
};

export function buildRouteOptions(
  routes: RoutePlan[],
  locale: string,
): FilterOption[] {
  return routes
    .map((route) => ({
      id: route.id,
      label: `${route.planDate} · ${route.representative.name}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

export function buildLocationOptions(
  locations: Location[],
  locale: string,
): FilterOption[] {
  return locations
    .map((location) => ({
      id: location.id,
      label: location.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}

export function buildLocationFieldOptions(
  locations: Location[],
  field: "city" | "territory",
  locale: string,
): FilterOption[] {
  const options = new Map<string, FilterOption>();

  for (const location of locations) {
    const value = location[field]?.trim();

    if (!value) {
      continue;
    }

    options.set(value, {
      id: value,
      label: value,
    });
  }

  return [...options.values()].sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}
