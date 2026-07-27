import type { VisitCancellationReason } from "./api-client";
import { formatLabel, type CommonTranslator } from "./format";

export const VISIT_CANCELLATION_REASONS: VisitCancellationReason[] = [
  "location_closed",
  "client_unavailable",
  "route_changed",
  "other",
];

// Narrows a raw value (form input, or a stored visit written by an older
// build) against the list the reason select is built from.
export function isVisitCancellationReason(
  value: unknown,
): value is VisitCancellationReason {
  return (
    typeof value === "string" &&
    (VISIT_CANCELLATION_REASONS as readonly string[]).includes(value)
  );
}

// Single source for the reason's display text, shared by every surface that
// renders it (cancel modal, manager list/detail, field history, cancelled
// visit page). Keys live under common.labels so both zones' dictionaries
// reach them; same dynamic-key cast and fallback as formatEnumLabel.
export function formatCancellationReason(
  t: CommonTranslator,
  reason: VisitCancellationReason,
): string {
  const key = `labels.cancelReason_${reason}`;

  return t.has(key as never) ? t(key as never) : formatLabel(reason);
}
