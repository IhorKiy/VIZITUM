import type { NoOrderReason, VisitOutcome } from "./api-client";

export const NO_ORDER_REASONS: NoOrderReason[] = [
  "closed",
  "no_decision_maker",
  "has_stock",
  "no_money",
  "refused",
  "other",
];

// Narrows a raw value (an AI draft, or a stored report written by an older
// build) against the list the reason chips are built from.
export function isNoOrderReason(value: unknown): value is NoOrderReason {
  return (
    typeof value === "string" &&
    (NO_ORDER_REASONS as readonly string[]).includes(value)
  );
}

// The field form now records the visit result as the fact a rep actually has
// — an order was placed or it wasn't, plus why not — instead of asking for a
// positive/neutral/negative judgement. Manager-facing views and every
// already-confirmed report still read `fieldReport.outcome`, so it stays in
// the payload, derived here rather than typed by hand.
//
// A visit with no order is only "negative" when the customer could have
// bought and didn't (no money, refused). A closed door, an absent
// decision-maker or a shelf that is still full are ordinary cycle outcomes,
// not lost sales, so they stay neutral — grading them as negative would make
// the metric track route timing rather than selling.
export function deriveVisitOutcome(
  orderPlaced: boolean,
  noOrderReason: NoOrderReason | null,
): VisitOutcome {
  if (orderPlaced) return "positive";

  return noOrderReason === "no_money" || noOrderReason === "refused"
    ? "negative"
    : "neutral";
}
