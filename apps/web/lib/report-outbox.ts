// The queue of confirmed reports that have not reached the server yet.
//
// Confirming a report is the moment a visit becomes a record, and until now it
// needed signal to happen at all: the rep pressed save, the request failed, and
// they were left holding a finished report with nowhere to put it. A confirm now
// lands in this queue first and is sent from there, so the rep can walk out of
// the basement and keep working while it goes.
//
// Separate from both other stores on purpose. Drafts are cleared on sign-out
// because they can be retyped; captures are bytes that cannot be recreated; this
// is *work the rep has already finished and signed off*, which must survive
// sign-out and must never be swept by age — a report nobody sent is not stale,
// it is missing.

import {
  commitTransaction,
  CREATED_AT_INDEX,
  KEY_SEPARATOR,
  OUTBOX_STORE,
  promisifyRequest,
  runOnFieldDatabase,
  STORAGE_TEARDOWN_TIMEOUT_MS,
} from "./field-db";

// One queued confirm per visit. A rep who reopens a visit whose confirm has not
// gone out yet and confirms again replaces it — that second press is their
// latest intent, not a second report.
export type ReportOutboxScope = {
  tenantSlug: string;
  userId: string;
};

export type ReportOutboxEntry = {
  // The record's own storage key, carried so every later operation addresses the
  // exact row the list returned. Recomputing it at each call site meant a record
  // whose key did not match the current formula — an older build's, say — stayed
  // visible in the unsent count while being impossible to send or clear.
  key: string;
  visitId: string;
  tenantSlug: string;
  userId: string;
  // The idempotency token the server matches on. Minted per *confirm*, not per
  // visit: a retry of one confirm reuses it so the server recognises the replay,
  // while a deliberate re-confirm gets a new one and is meant to overwrite.
  clientRequestId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  // Set when the server answered and refused. Such an item is never retried
  // automatically — the answer will not change on its own, and a queue that
  // retries a doomed report forever shows the rep a count that never clears.
  // It is kept rather than deleted, because deleting it would throw away work
  // the rep already finished; the recovery is to reopen the visit and confirm
  // again, which the server still allows since it never accepted this one.
  rejectedAt: number | null;
};

type OutboxRecord = ReportOutboxEntry;

function outboxKey(scope: ReportOutboxScope, visitId: string): string {
  return [scope.tenantSlug, scope.userId, visitId].join(KEY_SEPARATOR);
}

function toEntry(record: OutboxRecord): ReportOutboxEntry {
  return {
    key: record.key,
    visitId: record.visitId,
    tenantSlug: record.tenantSlug,
    userId: record.userId,
    clientRequestId: record.clientRequestId,
    payload: record.payload,
    createdAt: record.createdAt,
    attempts: record.attempts,
    lastError: record.lastError,
    rejectedAt: record.rejectedAt,
  };
}

export function enqueueReportConfirm(
  scope: ReportOutboxScope,
  visitId: string,
  clientRequestId: string,
  payload: Record<string, unknown>,
  // Returns the record's storage key on success, so the caller can address this
  // exact row later, and null when the device would not keep it — which the
  // caller has to surface rather than swallow. A device that did not answer in
  // time counts as "would not keep it": this is awaited on the way to the
  // network on every single save, so an unbounded wait here is a save button
  // that does nothing.
): Promise<string | null> {
  return runOnFieldDatabase<string | null>(null, async (database) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const key = outboxKey(scope, visitId);
    const record: OutboxRecord = {
      key,
      visitId,
      tenantSlug: scope.tenantSlug,
      userId: scope.userId,
      clientRequestId,
      payload,
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
      rejectedAt: null,
    };

    transaction.objectStore(OUTBOX_STORE).put(record);

    // Resolved on the commit, not the request: a queued report the device did
    // not actually keep is the one failure this whole queue exists to prevent,
    // and the caller has to be able to tell the rep the truth about it.
    await commitTransaction(transaction);

    return key;
  });
}

// Oldest first: a rep who worked through four dead stops should have them arrive
// in the order they happened.
export function listReportOutbox(
  scope: ReportOutboxScope,
): Promise<ReportOutboxEntry[]> {
  return runOnFieldDatabase<ReportOutboxEntry[]>([], async (database) => {
    const store = database
      .transaction(OUTBOX_STORE, "readonly")
      .objectStore(OUTBOX_STORE);
    const records = await promisifyRequest(
      store.index(CREATED_AT_INDEX).getAll() as IDBRequest<OutboxRecord[]>,
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

// Left queued if this does not land, which only costs one more replay the server
// will recognise — so the confirm flow never waits long on it.
export function deleteReportOutboxEntry(key: string): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(OUTBOX_STORE, "readwrite");

      transaction.objectStore(OUTBOX_STORE).delete(key);

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// A lightweight existence check — getKey() rather than get() — for callers
// that only need to know whether a confirm is waiting on this visit, not read
// its payload. "One queued confirm per visit" (see outboxKey) is what makes
// this a single lookup instead of a scan of the whole outbox.
export function hasReportOutboxEntryForVisit(
  scope: ReportOutboxScope,
  visitId: string,
): Promise<boolean> {
  return runOnFieldDatabase<boolean>(false, async (database) => {
    const store = database
      .transaction(OUTBOX_STORE, "readonly")
      .objectStore(OUTBOX_STORE);
    const key = await promisifyRequest(store.getKey(outboxKey(scope, visitId)));

    return key !== undefined;
  });
}

// Cancelling a visit must not leave its queued confirm behind: unlike a rep
// standing at the screen when a send is refused, nobody is left to reopen a
// visit that cancelling is about to lock. Bounded the same as
// deleteReportOutboxEntry, but the trade-off is worse here if it times out:
// the entry stays, the next flush hits the visit's now-cancelled status,
// gets refused, and lands right back in the stuck-forever state this
// function exists to close — just gated on storage not answering in time
// rather than happening on every cancel.
export function deleteReportOutboxEntryForVisit(
  scope: ReportOutboxScope,
  visitId: string,
): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(OUTBOX_STORE, "readwrite");

      transaction.objectStore(OUTBOX_STORE).delete(outboxKey(scope, visitId));

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// Moves a queued confirm from one visit id to another, patching both the
// record's storage key and its `visitId` field — report-outbox-flush.ts reads
// `entry.visitId` to build the confirm POST, so rekeying only the key would
// leave the request pointing at the old id, silently reintroducing the exact
// "the visit this points at can never be found again" failure this exists to
// close. One atomic transaction, same shape as offline-drafts.ts's rekey
// helpers. The one caller is visit-start-outbox-flush.ts, for a rep who
// confirmed a report before the visit holding it had finished syncing under
// its real id.
//
// Clears any rejection in the same move. The only way a confirm still keyed to
// a client-minted id can carry one is `rejectReportOutboxEntryForVisit` below,
// which marks it because the start it belonged to was refused — and a start
// that reaches this function has since succeeded, so the reason that entry was
// refused no longer exists. Leaving the mark would keep a report the server
// will now accept out of every automatic flush.
export function rekeyReportOutboxEntry(
  scope: ReportOutboxScope,
  fromVisitId: string,
  toVisitId: string,
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    const fromKey = outboxKey(scope, fromVisitId);
    const record = await promisifyRequest(
      store.get(fromKey) as IDBRequest<OutboxRecord | undefined>,
    );

    if (record) {
      store.put({
        ...record,
        key: outboxKey(scope, toVisitId),
        visitId: toVisitId,
        rejectedAt: null,
        lastError: null,
      });
      store.delete(fromKey);
    }

    await commitTransaction(transaction);

    return true;
  });
}

// Marks a queued confirm refused because the visit it names can never exist:
// the deferred start that would have created it was itself rejected by the
// server (see visit-start-outbox-flush.ts).
//
// Without this the entry is not wrong so much as unanswerable — every flush
// sends it, the server replies `VISIT_NOT_FOUND`, and report-send-outcome.ts
// correctly reads that as "queue, the start hasn't caught up yet" for a start
// that is never going to catch up. The rep watches a pending count that can
// never reach zero and is told nothing about why.
//
// Marked rather than deleted, like every other rejection here: this is a
// report the rep already finished and signed off, and the manual "send now"
// still retries it — which is not futile, because that same tap retries the
// rejected start first, and a start that succeeds on retry rekeys this entry
// (clearing the mark) before the confirm queue is drained.
export function rejectReportOutboxEntryForVisit(
  scope: ReportOutboxScope,
  visitId: string,
  lastError: string,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    const existing = await promisifyRequest(
      store.get(outboxKey(scope, visitId)) as IDBRequest<
        OutboxRecord | undefined
      >,
    );

    if (existing) {
      store.put({ ...existing, lastError, rejectedAt: Date.now() });
    }

    await commitTransaction(transaction);
  });
}

// Records a failed attempt so the count the rep sees is honest about why, and so
// a permanently-failing item is visible rather than silently retried forever.
// The attempt counter is diagnostic; losing it does not lose the report.
export function recordReportOutboxFailure(
  key: string,
  lastError: string,
  rejected = false,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const store = transaction.objectStore(OUTBOX_STORE);
    const existing = await promisifyRequest(
      store.get(key) as IDBRequest<OutboxRecord | undefined>,
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
