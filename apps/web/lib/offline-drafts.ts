// On-device storage for work a rep has started but not sent. Reps lose signal
// at a couple of stops a day, and until now every piece of a report lived in
// React state — a reload, a killed tab or a backgrounded phone took the whole
// thing with it. This is the durable side of the form.
//
// Deliberately hand-rolled over IndexedDB rather than pulling in a wrapper: the
// surface is one object store with get/put/delete/prune, and every call has to
// degrade to a no-op instead of throwing (private browsing, a storage quota
// refusal, or an old WebView all fail here and none of them may take the report
// screen down with them).

const DATABASE_NAME = "vizitum-field";
const DATABASE_VERSION = 1;
// Report drafts only. Deferred sends will get their own store, because logout
// clears this one and must not clear a queue of unsent work.
const DRAFT_STORE = "report-drafts";
const UPDATED_AT_INDEX = "updatedAt";

// A draft outlives a phone left in a drawer over a long weekend but not a
// forgotten visit: past this the record is swept so the device does not
// accumulate reports nobody is going to finish.
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// One rep, one tenant, one visit. The user is part of the key because reps do
// share phones, and a draft must never surface under the next person's login.
export type DraftScope = {
  tenantSlug: string;
  userId: string;
  visitId: string;
};

type DraftRecord = {
  key: string;
  updatedAt: number;
  version: number;
  payload: unknown;
};

// NUL cannot appear in a slug, a user id or a visit id, so it is the one
// separator that cannot be smuggled in to collide two scopes.
function draftKey(scope: DraftScope): string {
  return [scope.tenantSlug, scope.userId, scope.visitId].join("\u0000");
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    // A failed open is cached as "unavailable" for this attempt only — a quota
    // prompt the rep dismisses once should not disable drafts for the session.
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

      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        const store = database.createObjectStore(DRAFT_STORE, {
          keyPath: "key",
        });
        store.createIndex(UPDATED_AT_INDEX, "updatedAt");
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

// The rejection reason is never read — every caller swallows it and falls back
// to "no draft" — but it has to be a real Error for the failure to be legible
// if one of them ever stops.
function storageError(error: DOMException | null): Error {
  return error ?? new Error("IndexedDB request failed");
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

// `version` belongs to the caller's payload shape, not to this store: a record
// written under a different one is dropped rather than half-read, which is what
// keeps a future change to the draft shape from having to migrate anything.
export async function readDraft(
  scope: DraftScope,
  version: number,
): Promise<unknown> {
  const database = await openDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readonly")
      .objectStore(DRAFT_STORE);
    const record = await promisify(
      store.get(draftKey(scope)) as IDBRequest<DraftRecord | undefined>,
    );

    if (!record || record.version !== version) return null;

    return record.payload;
  } catch {
    return null;
  }
}

export async function writeDraft(
  scope: DraftScope,
  payload: unknown,
  version: number,
): Promise<boolean> {
  const database = await openDatabase();

  if (!database) return false;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);
    const record: DraftRecord = {
      key: draftKey(scope),
      updatedAt: Date.now(),
      version,
      payload,
    };

    await promisify(store.put(record));

    return true;
  } catch {
    return false;
  }
}

export async function deleteDraft(scope: DraftScope): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);

    await promisify(store.delete(draftKey(scope)));
  } catch {
    // A draft that outlives its report is swept by age anyway.
  }
}

// Sweeps drafts nobody came back to. Runs off the `updatedAt` index so an
// untouched device does not walk every record it has ever written.
export async function pruneDrafts(
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);
    const range = IDBKeyRange.upperBound(Date.now() - maxAgeMs);
    const request = store.index(UPDATED_AT_INDEX).openCursor(range);

    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;

        if (!cursor) {
          resolve();
          return;
        }

        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(storageError(request.error));
    });
  } catch {
    // Best effort: a device that cannot prune still works, it just keeps a
    // handful of stale records.
  }
}

// Signing out hands the device to whoever holds it next, so nothing half-typed
// is left behind. Drafts are convenience state — the confirmed reports they
// came from are already on the server — which is why this can clear the whole
// store without asking. Anything representing unsent work will live elsewhere
// and must survive logout.
export async function clearDrafts(): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);

    await promisify(store.clear());
  } catch {
    // Nothing actionable: the sweep above is the backstop.
  }
}
