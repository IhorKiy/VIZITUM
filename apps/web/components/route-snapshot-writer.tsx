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
// A plain mount-time effect is enough — field/page.tsx is a server component,
// so this only remounts when the rep actually reloads or navigates here, which
// is exactly "every successful field-home render".
export function RouteSnapshotWriter({
  tenantSlug,
  stops,
  labels,
}: RouteSnapshotWriterProps) {
  // Deliberately mount-only: see the comment above for why a server-component
  // parent means this never needs to react to a client-side prop change.
  useEffect(() => {
    void writeRouteSnapshot(tenantSlug, { stops, labels });
  }, []);

  return null;
}
