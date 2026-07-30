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
  openFieldDatabase,
  OUTBOX_STORE,
  promisifyRequest,
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

export async function enqueueReportConfirm(
  scope: ReportOutboxScope,
  visitId: string,
  clientRequestId: string,
  payload: Record<string, unknown>,
  // Returns the record's storage key on success, so the caller can address this
  // exact row later, and null when the device would not keep it — which the
  // caller has to surface rather than swallow.
): Promise<string | null> {
  const database = await openFieldDatabase();

  if (!database) return null;

  try {
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
  } catch {
    return null;
  }
}

// Oldest first: a rep who worked through four dead stops should have them arrive
// in the order they happened.
export async function listReportOutbox(
  scope: ReportOutboxScope,
): Promise<ReportOutboxEntry[]> {
  const database = await openFieldDatabase();

  if (!database) return [];

  try {
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
  } catch {
    return [];
  }
}

export async function deleteReportOutboxEntry(key: string): Promise<void> {
  const database = await openFieldDatabase();

  if (!database) return;

  try {
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");

    transaction.objectStore(OUTBOX_STORE).delete(key);

    await commitTransaction(transaction);
  } catch {
    // Left queued, which only costs one more replay the server will recognise.
  }
}

// Records a failed attempt so the count the rep sees is honest about why, and so
// a permanently-failing item is visible rather than silently retried forever.
export async function recordReportOutboxFailure(
  key: string,
  lastError: string,
  rejected = false,
): Promise<void> {
  const database = await openFieldDatabase();

  if (!database) return;

  try {
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
  } catch {
    // The attempt counter is diagnostic; losing it does not lose the report.
  }
}
