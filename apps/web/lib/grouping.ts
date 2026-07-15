export type EntityGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

// Group rows under a heading for the admin "by X" views (products by category,
// locations by chain): named groups first (alphabetical in the tenant locale),
// the empty-key fallback bucket last.
export function buildEntityGroups<T>(
  items: T[],
  getKey: (item: T) => string | null | undefined,
  getLabel: (item: T) => string | null | undefined,
  fallbackLabel: string,
  locale: string,
): EntityGroup<T>[] {
  const groups = new Map<string, EntityGroup<T>>();

  for (const item of items) {
    const key = getKey(item) ?? "";
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, {
        key,
        label: getLabel(item) ?? fallbackLabel,
        items: [item],
      });
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === "") {
      return 1;
    }

    if (b.key === "") {
      return -1;
    }

    return a.label.localeCompare(b.label, locale);
  });
}
