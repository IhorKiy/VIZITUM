import type { AssortmentStatus } from "./api-client";

export const ASSORTMENT_STATUSES: AssortmentStatus[] = [
  "in_stock",
  "out_of_stock",
  "to_order",
  "not_relevant",
];

// Narrows a raw form value against the same list the assortment <select>s are
// built from, so the detail pages' upsert actions can validate `status` before
// sending it rather than casting it on trust and letting a bad value make a
// round trip to the backend just to be rejected.
export function isAssortmentStatus(value: string): value is AssortmentStatus {
  return (ASSORTMENT_STATUSES as readonly string[]).includes(value);
}
