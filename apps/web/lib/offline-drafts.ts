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
const DATABASE_VERSION = 2;
// What the rep typed. Cleared on sign-out and swept by age.
const DRAFT_STORE = "report-drafts";
// Recorded or photographed bytes that have not reached storage yet. A separate
// store precisely because sign-out clears the one above: what the rep typed can
// be retyped, a recording of a conversation that already happened cannot be
// recovered from anything.
const MEDIA_STORE = "pending-media";
const UPDATED_AT_INDEX = "updatedAt";

// A draft outlives a phone left in a drawer over a long weekend but not a
// forgotten visit: past this the record is swept so the device does not
// accumulate reports nobody is going to finish.
export const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Deliberately shorter than the draft retention, and not because media matters
// less. iOS Safari evicts all script-writable storage after seven days without
// a Home Screen install, so a longer promise is one the platform does not keep
// — and unsent recordings are bulky enough that stale ones cost the rep real
// space on the device.
export const PENDING_MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// One rep, one tenant, one visit. The user is part of the key because reps do
// share phones, and a draft must never surface under the next person's login.
export type DraftScope = {
  tenantSlug: string;
  userId: string;
  visitId: string;
};

export type PendingMediaKind = "audio" | "photo";

// Stored as an ArrayBuffer rather than the Blob the recorder hands over: WebKit
// can drop the file backing a stored Blob while the record around it survives,
// and that only shows up at retry — as a zero-length upload the server happily
// accepts. The mime type travels beside the bytes for the same reason; guessing
// it later would mislabel an iPhone's mp4 as webm and fail downstream.
export type PendingMediaBytes = {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName: string;
};

type DraftRecord = {
  key: string;
  updatedAt: number;
  version: number;
  payload: unknown;
};

// The bytes and the registration they have already consumed are two records
// rather than one. Bytes are written once, at capture; the registration id
// arrives later and changes on its own schedule, and IndexedDB can only replace
// a whole value — so keeping them together would mean rewriting several
// megabytes to record one string, with a real chance of losing the bytes to a
// quota failure part-way through.
type MediaBytesRecord = PendingMediaBytes & {
  key: string;
  updatedAt: number;
};

type MediaRegistrationRecord = {
  key: string;
  updatedAt: number;
  objectId: string | null;
};

// NUL cannot appear in a slug, a user id or a visit id, so it is the one
// separator that cannot be smuggled in to collide two scopes.
function draftKey(scope: DraftScope): string {
  return [scope.tenantSlug, scope.userId, scope.visitId].join("\u0000");
}

function mediaKey(
  scope: DraftScope,
  kind: PendingMediaKind,
  part: "bytes" | "registration",
): string {
  return [draftKey(scope), kind, part].join("\u0000");
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

      // Guarded per store rather than switched on the old version, so a device
      // arriving from any earlier version — or from none — ends up with both.
      for (const name of [DRAFT_STORE, MEDIA_STORE]) {
        if (database.objectStoreNames.contains(name)) continue;

        const store = database.createObjectStore(name, { keyPath: "key" });

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

// A successful `put` request is not a successful write: the transaction around
// it can still abort afterwards — which is exactly what a quota refusal or an
// iOS-suspended page does. Waiting for the commit is the difference between
// telling the rep their recording is safe and it actually being safe.
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => reject(storageError(transaction.error));
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
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const record: DraftRecord = {
      key: draftKey(scope),
      updatedAt: Date.now(),
      version,
      payload,
    };

    transaction.objectStore(DRAFT_STORE).put(record);

    await committed(transaction);

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

// Sweeps records nobody came back to. Runs off the `updatedAt` index so an
// untouched device does not walk every record it has ever written.
async function pruneStore(storeName: string, maxAgeMs: number): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(storeName, "readwrite")
      .objectStore(storeName);
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

export async function pruneDrafts(
  maxAgeMs: number = DRAFT_MAX_AGE_MS,
): Promise<void> {
  await pruneStore(DRAFT_STORE, maxAgeMs);
}

export async function prunePendingMedia(
  maxAgeMs: number = PENDING_MEDIA_MAX_AGE_MS,
): Promise<void> {
  await pruneStore(MEDIA_STORE, maxAgeMs);
}

// Signing out hands the device to whoever holds it next, so nothing half-typed
// is left behind. Drafts are convenience state — the confirmed reports they
// came from are already on the server — which is why this can clear the whole
// store without asking.
//
// `pending-media` is deliberately NOT cleared here. Those bytes are the one
// thing on the device that exists nowhere else: a conversation that already
// happened cannot be recorded again. They stay keyed to the rep who captured
// them, so the next person to sign in cannot reach them, and they age out on
// their own. The residual risk is real — IndexedDB is not encrypted at rest —
// and it is accepted deliberately, because losing the recording is the worse
// outcome for the person doing the work.
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

// --- Pending media -------------------------------------------------------

// Written the instant a recording stops, before any upload is attempted, so the
// window in which the bytes exist only in memory is as close to zero as it can
// be. Returns false when the device would not take them — private browsing, a
// quota refusal, an old WebView — which the caller has to surface rather than
// swallow: for a convenience draft a silent no-op is right, but here it decides
// whether the rep can safely leave the screen.
export async function writePendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
  media: PendingMediaBytes,
): Promise<boolean> {
  const database = await openDatabase();

  if (!database) return false;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaBytesRecord = {
      key: mediaKey(scope, kind, "bytes"),
      updatedAt: Date.now(),
      ...media,
    };

    transaction.objectStore(MEDIA_STORE).put(record);

    await committed(transaction);

    return true;
  } catch {
    return false;
  }
}

export async function readPendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<PendingMediaBytes | null> {
  const database = await openDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const record = await promisify(
      store.get(mediaKey(scope, kind, "bytes")) as IDBRequest<
        MediaBytesRecord | undefined
      >,
    );

    // A record whose bytes did not survive is worse than no record: it would
    // upload an empty file the server accepts without complaint.
    if (!record || !(record.bytes instanceof ArrayBuffer)) return null;
    if (record.bytes.byteLength === 0) return null;

    return {
      bytes: record.bytes,
      mimeType: record.mimeType,
      fileName: record.fileName,
    };
  } catch {
    return null;
  }
}

// Kept apart from the bytes so recording which registration they consumed costs
// one small write rather than rewriting the whole recording.
export async function writePendingMediaRegistration(
  scope: DraftScope,
  kind: PendingMediaKind,
  objectId: string | null,
): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaRegistrationRecord = {
      key: mediaKey(scope, kind, "registration"),
      updatedAt: Date.now(),
      objectId,
    };

    transaction.objectStore(MEDIA_STORE).put(record);

    await committed(transaction);
  } catch {
    // The bytes are what matter; losing the id only costs one extra
    // registration on the next attempt.
  }
}

export async function readPendingMediaRegistration(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<string | null> {
  const database = await openDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const record = await promisify(
      store.get(mediaKey(scope, kind, "registration")) as IDBRequest<
        MediaRegistrationRecord | undefined
      >,
    );

    return record?.objectId ?? null;
  } catch {
    return null;
  }
}

export async function deletePendingMedia(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<void> {
  const database = await openDatabase();

  if (!database) return;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE);

    store.delete(mediaKey(scope, kind, "bytes"));
    store.delete(mediaKey(scope, kind, "registration"));

    await committed(transaction);
  } catch {
    // Swept by age otherwise.
  }
}
