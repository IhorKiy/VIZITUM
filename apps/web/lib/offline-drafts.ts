// The two on-device stores the report form itself reads and writes: what the rep
// typed (a draft) and bytes they captured that never reached storage. The shared
// connection, the store names and the IndexedDB helpers live in field-db.ts,
// alongside the reasoning for why these are separate stores at all.

import {
  commitTransaction,
  DRAFT_STORE,
  KEY_SEPARATOR,
  MEDIA_STORE,
  openFieldDatabase,
  promisifyRequest,
  UPDATED_AT_INDEX,
} from "./field-db";

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
  return [scope.tenantSlug, scope.userId, scope.visitId].join(KEY_SEPARATOR);
}

function mediaKey(
  scope: DraftScope,
  kind: PendingMediaKind,
  part: "bytes" | "registration",
): string {
  return [draftKey(scope), kind, part].join(KEY_SEPARATOR);
}

// `version` belongs to the caller's payload shape, not to this store: a record
// written under a different one is dropped rather than half-read, which is what
// keeps a future change to the draft shape from having to migrate anything.
export async function readDraft(
  scope: DraftScope,
  version: number,
): Promise<unknown> {
  const database = await openFieldDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readonly")
      .objectStore(DRAFT_STORE);
    const record = await promisifyRequest(
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
  const database = await openFieldDatabase();

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

    await commitTransaction(transaction);

    return true;
  } catch {
    return false;
  }
}

export async function deleteDraft(scope: DraftScope): Promise<void> {
  const database = await openFieldDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);

    await promisifyRequest(store.delete(draftKey(scope)));
  } catch {
    // A draft that outlives its report is swept by age anyway.
  }
}

// Sweeps records nobody came back to. Runs off the `updatedAt` index so an
// untouched device does not walk every record it has ever written.
async function pruneStore(storeName: string, maxAgeMs: number): Promise<void> {
  const database = await openFieldDatabase();

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
      request.onerror = () => reject(new Error("IndexedDB cursor failed"));
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
  const database = await openFieldDatabase();

  if (!database) return;

  try {
    const store = database
      .transaction(DRAFT_STORE, "readwrite")
      .objectStore(DRAFT_STORE);

    await promisifyRequest(store.clear());
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
  const database = await openFieldDatabase();

  if (!database) return false;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaBytesRecord = {
      key: mediaKey(scope, kind, "bytes"),
      updatedAt: Date.now(),
      ...media,
    };
    const store = transaction.objectStore(MEDIA_STORE);

    store.put(record);
    // Fresh bytes invalidate whatever registration the capture they replace
    // had consumed, and the two are separate records, so nothing else would
    // clear it: a second recording written over the first would be paired with
    // the first one's storage object and uploaded into it. Dropped in this same
    // transaction rather than afterwards, because the caller's next step is a
    // network call — exactly the one that fails here — and a half-applied
    // replacement is the state that produces the mismatch.
    store.delete(mediaKey(scope, kind, "registration"));

    await commitTransaction(transaction);

    return true;
  } catch {
    return false;
  }
}

export async function readPendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<PendingMediaBytes | null> {
  const database = await openFieldDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const record = await promisifyRequest(
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
  const database = await openFieldDatabase();

  if (!database) return;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaRegistrationRecord = {
      key: mediaKey(scope, kind, "registration"),
      updatedAt: Date.now(),
      objectId,
    };

    transaction.objectStore(MEDIA_STORE).put(record);

    await commitTransaction(transaction);
  } catch {
    // The bytes are what matter; losing the id only costs one extra
    // registration on the next attempt.
  }
}

export async function readPendingMediaRegistration(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<string | null> {
  const database = await openFieldDatabase();

  if (!database) return null;

  try {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const record = await promisifyRequest(
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
  const database = await openFieldDatabase();

  if (!database) return;

  try {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE);

    store.delete(mediaKey(scope, kind, "bytes"));
    store.delete(mediaKey(scope, kind, "registration"));

    await commitTransaction(transaction);
  } catch {
    // Swept by age otherwise.
  }
}
