// The one IndexedDB connection the field zone's three on-device stores share,
// and the handful of helpers that make raw IndexedDB bearable.
//
// Deliberately hand-rolled rather than pulling in a wrapper: the surface is
// get/put/delete/cursor, and every caller has to be able to degrade instead of
// throwing — private browsing, a quota refusal and an old WebView all fail here,
// and none of them may take a report screen down with them.
//
// The three stores are kept separate because their lifetimes genuinely differ,
// and conflating them would mean deleting the wrong thing at sign-out:
//
//   report-drafts   what the rep typed — retypeable, so cleared on sign-out and
//                   swept by age
//   pending-media   recorded or photographed bytes that never reached storage —
//                   not recreatable, so kept across sign-out, swept by age
//   report-outbox   confirms the rep has already signed off but the server has
//                   not seen — kept across sign-out and never swept by age,
//                   because a report nobody sent is not stale, it is missing

const DATABASE_NAME = "vizitum-field";
// 1: report-drafts. 2: pending-media. 3: report-outbox.
const DATABASE_VERSION = 3;

export const DRAFT_STORE = "report-drafts";
export const MEDIA_STORE = "pending-media";
export const OUTBOX_STORE = "report-outbox";

export const UPDATED_AT_INDEX = "updatedAt";
export const CREATED_AT_INDEX = "createdAt";

// NUL cannot appear in a slug, a user id or a visit id, so it is the one
// separator that cannot be smuggled in to collide two scopes.
export const KEY_SEPARATOR = "\u0000";

let databasePromise: Promise<IDBDatabase | null> | null = null;

export function openFieldDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    // A failed open is cached as "unavailable" for this attempt only — a quota
    // prompt the rep dismisses once should not disable storage for the session.
    const giveUp = () => {
      databasePromise = null;
      resolve(null);
    };

    let request: IDBOpenDBRequest;

    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      giveUp();
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;

      // Guarded per store rather than switched on the old version, so a device
      // arriving from any earlier version — or from none — ends up with all of
      // them. This is also what saves a database that reached a version without
      // its store (a half-applied upgrade): the next version bump creates it.
      for (const [name, index] of [
        [DRAFT_STORE, UPDATED_AT_INDEX],
        [MEDIA_STORE, UPDATED_AT_INDEX],
        [OUTBOX_STORE, CREATED_AT_INDEX],
      ] as const) {
        if (database.objectStoreNames.contains(name)) continue;

        const store = database.createObjectStore(name, { keyPath: "key" });

        store.createIndex(index, index);
      }
    };
    request.onsuccess = () => {
      const database = request.result;

      // Another tab upgrading the schema must not be blocked by this one
      // holding the old version open.
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      database.onclose = () => {
        databasePromise = null;
      };

      resolve(database);
    };
    request.onerror = giveUp;
    request.onblocked = giveUp;
  });

  return databasePromise;
}

// The rejection reason is never read — callers swallow it and fall back to
// "nothing stored" — but it has to be a real Error for the failure to be legible
// if one of them ever stops.
export function storageError(error: DOMException | null): Error {
  return error ?? new Error("IndexedDB request failed");
}

export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

// A successful `put` request is not a successful write: the transaction around
// it can still abort afterwards — which is exactly what a quota refusal or an
// iOS-suspended page does. Waiting for the commit is the difference between
// telling the rep their work is safe and it actually being safe.
export function commitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
  });
}
