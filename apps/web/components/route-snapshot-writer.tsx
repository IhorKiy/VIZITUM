"use client";

import { useEffect } from "react";

import {
  writeRouteSnapshot,
  type RouteSnapshotLabels,
  type RouteSnapshotStop,
} from "../lib/route-snapshot";

type RouteSnapshotWriterProps = {
  tenantSlug: string;
  stops: RouteSnapshotStop[];
  labels: RouteSnapshotLabels;
};

// Renders nothing — the one job is persisting what field/page.tsx just
// rendered, so a rep who reopens the app with no signal at all still sees
// today's route instead of nothing (public/offline.html reads this back; see
// route-snapshot.ts for why that has to be a separate, non-React reader).
//
// Kept apart from today-route-drag-list.tsx on purpose: that component owns
// the drag/reorder UI, and this owns persistence, matching how
// ReportOutboxIndicator sits beside the report form rather than inside it.
//
// The effect depends on serialized stops/labels, not a mount-only `[]` —
// field/page.tsx being a server component does not mean this only remounts
// on a fresh page load. `ReportOutboxIndicator`'s `router.refresh()` and
// every server action on this page that redirects back to `/field` (marking
// a stop visited, adding/removing one, reordering) re-render this same
// segment tree in place, at the same position, with new props — this
// component is not remounted, only re-rendered — so a mount-only effect
// would miss every one of those and leave the snapshot showing whatever was
// true before the rep's last action. Serializing is what turns "did the
// props change" into something an effect can actually depend on: fresh
// array/object identity on every render would otherwise make any
// non-empty dependency list fire just as often as no list at all.
export function RouteSnapshotWriter({
  tenantSlug,
  stops,
  labels,
}: RouteSnapshotWriterProps) {
  const stopsKey = JSON.stringify(stops);
  const labelsKey = JSON.stringify(labels);

  useEffect(() => {
    void writeRouteSnapshot(tenantSlug, { stops, labels });
    // stops/labels themselves are deliberately not in this list — stopsKey/
    // labelsKey are their stand-ins, so the effect fires on content change
    // rather than on every render's fresh array/object identity.
  }, [tenantSlug, stopsKey, labelsKey]);

  return null;
}
