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
  STORAGE_TEARDOWN_TIMEOUT_MS,
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
  // A route with no stops is a real, valid state (nothing planned today),
  // not an absent snapshot — offline.html tells the two apart by whether a
  // snapshot exists at all, so this is what fills the otherwise-blank list
  // rather than reusing the "no snapshot yet" message.
  emptyRoute: string;
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

// Signing out hands the phone to whoever holds it next — unlike the other
// four stores in this database, this one has no user in its key at all
// (offline.html reads it with no session to check), so a stale row here is
// reachable by *anyone* who opens this tenant's field zone offline next, not
// just the next person who happens to sign in as this same rep. Called from
// field-menu.tsx's sign-out handler alongside clearDrafts(), for the same
// reason and on the same footing: unlike pending-media (deliberately kept,
// since it is keyed to the rep who captured it and nothing else can reach
// it), this has no such protection, so it goes with the drafts, not with
// the recordings.
export function deleteRouteSnapshot(tenantSlug: string): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(
        ROUTE_SNAPSHOT_STORE,
        "readwrite",
      );

      transaction.objectStore(ROUTE_SNAPSHOT_STORE).delete(tenantSlug);

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}
