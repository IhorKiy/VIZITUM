// The queue of visits started with no signal at all — a device-minted id and
// enough to recreate the create request, sent from here once signal returns.
//
// Confirms and starts share this shape (queue first, send from the queue,
// never trust the eager attempt alone — see report-outbox.ts) but not one
// invariant: a confirm queue entry replaces on a second attempt at the same
// visit, because there is already a visit to aim the retry at. A start has no
// such target — each tap mints a fresh id — so entries here accumulate one
// per attempted start rather than collapsing.
//
// Never deleted on success, unlike report-outbox. The record IS the mapping
// from the id the rep's phone (its URL, its drafts, its captures) knows to
// whatever the server actually did with it. Discarding it the moment the
// create lands would work for the common case — the server usually stores
// this exact id back onto the row it created, and every visit-scoped lookup
// matches on it forever after — but not for the one case where the server
// instead hands back the rep's own already-open visit for that stop and never
// records this id anywhere. Without this row surviving, nothing anywhere
// could ever answer "what did clientVisitId actually become" again. See
// visit-start-outbox-flush.ts for how `resolvedVisitId` gets set, and why
// only that flush — never this module's own callers — is allowed to set it.

import {
  commitTransaction,
  CREATED_AT_INDEX,
  KEY_SEPARATOR,
  promisifyRequest,
  runOnFieldDatabase,
  STORAGE_TEARDOWN_TIMEOUT_MS,
  VISIT_START_STORE,
} from "./field-db";

export type VisitStartOutboxScope = {
  tenantSlug: string;
  userId: string;
};

export type VisitStartOutboxEntry = {
  key: string;
  clientVisitId: string;
  tenantSlug: string;
  userId: string;
  locationId: string;
  routeItemId: string | null;
  visitType: string;
  // Captured once, at the moment the rep tapped "start", and resent verbatim
  // on every retry — the backend's bounded window exists specifically to
  // record when the rep actually walked in, not when a retry happened to land.
  startedAt: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  rejectedAt: number | null;
  // Set the moment `POST /visits` first answers — independent of, and
  // always set no later than, `resolvedVisitId` below. Two different
  // writers keep that true: `recordVisitStartOutboxRemoteVisitId`, for a
  // queued start the background flush resolves, and `markVisitStartOutboxResolved`
  // itself backfills it too, for the eager online-start path
  // (start-visit-control.tsx) that only ever calls the latter. Durable
  // proof a real visit already exists even when the local rekey (pending
  // media, queued confirm) hasn't landed yet, which is what stops a
  // resolved-but-not-yet-rekeyed adopt from being replayed into a second,
  // unwanted visit: see visit-start-outbox-flush.ts for why re-sending the
  // create is not safe for that outcome the way it is for a plain one.
  remoteVisitId: string | null;
  // Set once the create has reached the server and every rekey that matters
  // has landed. Distinct from "deleted" — see the file header for why this
  // row survives success rather than being cleared like a confirm is.
  resolvedVisitId: string | null;
  resolvedAt: number | null;
};

type VisitStartOutboxRecord = VisitStartOutboxEntry;

function visitStartKey(
  scope: VisitStartOutboxScope,
  clientVisitId: string,
): string {
  return [scope.tenantSlug, scope.userId, clientVisitId].join(KEY_SEPARATOR);
}

// `remoteVisitId` is normalized here rather than trusted verbatim: it was
// added after this store shipped, and IndexedDB object stores are schemaless,
// so a record written before this field existed reads back `undefined` where
// null is expected, without any `DATABASE_VERSION` bump needed to fix it.
function toEntry(record: VisitStartOutboxRecord): VisitStartOutboxEntry {
  return { ...record, remoteVisitId: record.remoteVisitId ?? null };
}

export function enqueueVisitStart(
  scope: VisitStartOutboxScope,
  entry: {
    clientVisitId: string;
    locationId: string;
    routeItemId: string | null;
    visitType: string;
    startedAt: string;
  },
  // Returns the record's storage key on success, null when the device would
  // not keep it — same contract as enqueueReportConfirm, for the same reason:
  // this is awaited on the way to the network, so an unbounded wait here is a
  // "start visit" tap that does nothing.
): Promise<string | null> {
  return runOnFieldDatabase<string | null>(null, async (database) => {
    const transaction = database.transaction(VISIT_START_STORE, "readwrite");
    const key = visitStartKey(scope, entry.clientVisitId);
    const record: VisitStartOutboxRecord = {
      key,
      clientVisitId: entry.clientVisitId,
      tenantSlug: scope.tenantSlug,
      userId: scope.userId,
      locationId: entry.locationId,
      routeItemId: entry.routeItemId,
      visitType: entry.visitType,
      startedAt: entry.startedAt,
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
      rejectedAt: null,
      remoteVisitId: null,
      resolvedVisitId: null,
      resolvedAt: null,
    };

    transaction.objectStore(VISIT_START_STORE).put(record);

    await commitTransaction(transaction);

    return key;
  });
}

// Oldest first, same reason as listReportOutbox: a rep who started several
// stops offline should have them sync in the order they happened.
export function listVisitStartOutbox(
  scope: VisitStartOutboxScope,
): Promise<VisitStartOutboxEntry[]> {
  return runOnFieldDatabase<VisitStartOutboxEntry[]>([], async (database) => {
    const store = database
      .transaction(VISIT_START_STORE, "readonly")
      .objectStore(VISIT_START_STORE);
    const records = await promisifyRequest(
      store.index(CREATED_AT_INDEX).getAll() as IDBRequest<
        VisitStartOutboxRecord[]
      >,
    );

    return records
      .filter(
        (record) =>
          record.tenantSlug === scope.tenantSlug &&
          record.userId === scope.userId,
      )
      .map(toEntry);
  });
}

// A full read, not an existence check — callers need `resolvedVisitId` (the
// pending-visit fallback page, deciding whether to redirect) and every other
// field, not just whether the key is there.
export function getVisitStartOutboxEntry(
  scope: VisitStartOutboxScope,
  clientVisitId: string,
): Promise<VisitStartOutboxEntry | null> {
  return runOnFieldDatabase<VisitStartOutboxEntry | null>(
    null,
    async (database) => {
      const store = database
        .transaction(VISIT_START_STORE, "readonly")
        .objectStore(VISIT_START_STORE);
      const record = await promisifyRequest(
        store.get(visitStartKey(scope, clientVisitId)) as IDBRequest<
          VisitStartOutboxRecord | undefined
        >,
      );

      return record ? toEntry(record) : null;
    },
  );
}

// The location card's "is there already a queued start here" check — the
// server's own view of "active visit" only knows about visits it has heard
// of, so without this a rep who backs out and re-taps "start" while still
// offline would mint a second id for the same stop. Scans rather than a
// secondary index, same trade-off listVisitStartOutbox (and
// listReportOutbox before it) already makes: a handful of entries at most.
// Excludes a rejected entry so a genuinely failed start does not permanently
// block a fresh attempt.
export function findPendingVisitStartForLocation(
  scope: VisitStartOutboxScope,
  locationId: string,
): Promise<VisitStartOutboxEntry | null> {
  return listVisitStartOutbox(scope).then(
    (entries) =>
      entries.find(
        (entry) =>
          entry.locationId === locationId &&
          entry.resolvedVisitId === null &&
          entry.rejectedAt === null,
      ) ?? null,
  );
}

// The one exception to "never delete" in this file: an immediate rejection
// on the eager attempt, while the rep is still standing at the location card
// and about to be bounced to an error notice. There is nothing to remember —
// the entry never resolved, so it never became a mapping anything depends on
// — and tapping "start" again mints a fresh id through the ordinary path
// regardless, same reasoning deleteReportOutboxEntry already applies to a
// confirm rejected on the spot. Never called from the background flush,
// which keeps a rejection marked rather than deleted (see
// visit-start-outbox-flush.ts) since nobody is standing there to retry it.
export function deleteVisitStartOutboxEntry(key: string): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(VISIT_START_STORE, "readwrite");

      transaction.objectStore(VISIT_START_STORE).delete(key);

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// Records a failed attempt so a genuine rejection is visible and stops
// retrying, same shape and reasoning as recordReportOutboxFailure.
export function recordVisitStartOutboxFailure(
  key: string,
  lastError: string,
  rejected = false,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(VISIT_START_STORE, "readwrite");
    const store = transaction.objectStore(VISIT_START_STORE);
    const existing = await promisifyRequest(
      store.get(key) as IDBRequest<VisitStartOutboxRecord | undefined>,
    );

    if (existing) {
      store.put({
        ...existing,
        attempts: existing.attempts + 1,
        lastError,
        rejectedAt: rejected ? Date.now() : existing.rejectedAt,
      });
    }

    await commitTransaction(transaction);
  });
}

// Records the server's answer the moment it first arrives, before any rekey
// is attempted — see the field's own comment above for why this has to be
// durable and separate from `resolvedVisitId`. Never overwritten once set: a
// visit-start-outbox-flush.ts retry that reaches this entry again always
// passes the same id back (the server's own dual-id lookup guarantees that
// for a plain create, and the entry is never asked to re-resolve an adopt
// once this is set at all), so there is nothing to reconcile.
export function recordVisitStartOutboxRemoteVisitId(
  key: string,
  remoteVisitId: string,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(VISIT_START_STORE, "readwrite");
    const store = transaction.objectStore(VISIT_START_STORE);
    const existing = await promisifyRequest(
      store.get(key) as IDBRequest<VisitStartOutboxRecord | undefined>,
    );

    if (existing) {
      store.put({ ...existing, remoteVisitId });
    }

    await commitTransaction(transaction);
  });
}

// Marks a start resolved without deleting it — see the file header for why.
// Clears rejectedAt/lastError too: a resolved entry is not also a failed one,
// and a stale rejection would otherwise keep it out of
// findPendingVisitStartForLocation's "still pending" filter forever after
// having briefly failed on the way to eventually succeeding. Also backfills
// remoteVisitId when it's still null, in the same write — see that field's
// own comment for why this is the only place that guarantee can be kept for
// the eager, online-start path, which never calls
// recordVisitStartOutboxRemoteVisitId at all.
export function markVisitStartOutboxResolved(
  key: string,
  resolvedVisitId: string,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(VISIT_START_STORE, "readwrite");
    const store = transaction.objectStore(VISIT_START_STORE);
    const existing = await promisifyRequest(
      store.get(key) as IDBRequest<VisitStartOutboxRecord | undefined>,
    );

    if (existing) {
      store.put({
        ...existing,
        // Also backfills remoteVisitId when it's still null — the eager,
        // online-start path (start-visit-control.tsx) calls only this
        // function, never recordVisitStartOutboxRemoteVisitId, so without
        // this every visit started *with* signal — the common case — would
        // otherwise reach "resolved" with remoteVisitId permanently null,
        // contradicting this field's own "always set no later than
        // resolvedVisitId" guarantee.
        remoteVisitId: existing.remoteVisitId ?? resolvedVisitId,
        resolvedVisitId,
        resolvedAt: Date.now(),
        rejectedAt: null,
        lastError: null,
      });
    }

    await commitTransaction(transaction);
  });
}
