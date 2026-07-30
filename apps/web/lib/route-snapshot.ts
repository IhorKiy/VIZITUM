// Today's route, refreshed on every successful field-home render, so a rep
// who reopens the app with no signal at all still sees something instead of
// nothing — the piece nothing else in this system covers, since every other
// store here only keeps what the rep already typed or started, not the route
// itself. See field-db.ts for why the shared connection is shaped the way it
// is, and why this store, alone among the five, is keyed by tenant only.
//
// Written by route-snapshot-writer.tsx, a real React client component with
// next-intl and a signed-in session to draw on. Read back inside the Next.js
// app through readRouteSnapshot below — but *not* by public/offline.html,
// the standalone script the service worker serves in place of a failed
// navigation: that script has neither next-intl nor a session, sits outside
// this module graph entirely, and reads the same store directly, duplicating
// the database/store names as literal strings rather than importing them.

import {
  commitTransaction,
  promisifyRequest,
  ROUTE_SNAPSHOT_STORE,
  runOnFieldDatabase,
} from "./field-db";

export type RouteSnapshotStop = {
  id: string;
  locationId: string;
  name: string;
  address: string;
  chain: { id: string; name: string } | null;
  sequence: number;
  visited: boolean;
};

// Pre-resolved, tenant-language text — offline.html has no next-intl of its
// own, so whatever it shows has to already be in the right language by the
// time it lands here. No ICU/plural logic is stored: the writer, which does
// have next-intl, has already picked the right form.
export type RouteSnapshotLabels = {
  heading: string;
  offlineBanner: string;
  visitedBadge: string;
  notVisitedBadge: string;
};

export type RouteSnapshot = {
  key: string;
  tenantSlug: string;
  stops: RouteSnapshotStop[];
  labels: RouteSnapshotLabels;
  updatedAt: number;
};

type RouteSnapshotRecord = RouteSnapshot;

// Writes are always a full overwrite of the one row this tenant has on this
// device — there is nothing to merge, since the whole point is "what did the
// last successful render see."
export function writeRouteSnapshot(
  tenantSlug: string,
  snapshot: { stops: RouteSnapshotStop[]; labels: RouteSnapshotLabels },
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(ROUTE_SNAPSHOT_STORE, "readwrite");
    const record: RouteSnapshotRecord = {
      key: tenantSlug,
      tenantSlug,
      stops: snapshot.stops,
      labels: snapshot.labels,
      updatedAt: Date.now(),
    };

    transaction.objectStore(ROUTE_SNAPSHOT_STORE).put(record);

    await commitTransaction(transaction);

    return true;
  });
}

export function readRouteSnapshot(
  tenantSlug: string,
): Promise<RouteSnapshot | null> {
  return runOnFieldDatabase<RouteSnapshot | null>(null, async (database) => {
    const store = database
      .transaction(ROUTE_SNAPSHOT_STORE, "readonly")
      .objectStore(ROUTE_SNAPSHOT_STORE);
    const record = await promisifyRequest(
      store.get(tenantSlug) as IDBRequest<RouteSnapshotRecord | undefined>,
    );

    return record ?? null;
  });
}
