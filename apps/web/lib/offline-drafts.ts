// The two on-device stores the report form itself reads and writes: what the rep
// typed (a draft) and bytes they captured that never reached storage. The shared
// connection, the store names and the IndexedDB helpers live in field-db.ts,
// alongside the reasoning for why these are separate stores at all.

import {
  commitTransaction,
  DRAFT_STORE,
  KEY_SEPARATOR,
  MEDIA_STORE,
  promisifyRequest,
  runOnFieldDatabase,
  STORAGE_TEARDOWN_TIMEOUT_MS,
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

// What a key holds once the draft that lived there has moved somewhere else,
// or stopped existing: a forwarding address rather than a report.
//
// It exists because the rekey below cannot reach the one writer that matters.
// When a visit started with no signal finally resolves under the server's own
// id, visit-start-outbox-flush.ts moves this draft onto that id — but the
// report form is still mounted on the *old* one, and cannot be told from out
// here that the id under its feet just changed (props-down, one way, and its
// debounced write is already scheduled). Its next write, and the one its
// unmount always performs, would otherwise land back under an id nothing will
// ever navigate to again. So the old key keeps a note saying where writes go
// now, and every operation below honours it: the keystroke lands on the real
// visit instead of being orphaned beside it.
//
// `redirectTo: null` is the same mechanism turned off rather than redirected —
// abandon-visit-start.ts throwing away the work of a visit that will never
// exist anywhere, from a screen that performs that same unmount write on its
// way out. A late write there is dropped, not forwarded.
//
// One hop only, deliberately: a client-minted id forwards to a server id, and
// a server id is never rekeyed again, so a chain cannot form.
type DraftRedirectRecord = {
  key: string;
  updatedAt: number;
  redirectTo: string | null;
};

type StoredDraftRecord = DraftRecord | DraftRedirectRecord;

function isRedirect(record: StoredDraftRecord): record is DraftRedirectRecord {
  return "redirectTo" in record;
}

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

// Where a scope's draft actually lives, following at most one forwarding
// address, plus whatever is stored there. `null` means writes for this scope
// are meant to be dropped rather than stored anywhere.
//
// Takes an already-open store rather than opening its own, so a caller's
// lookup and its write stay inside one transaction — which is what makes
// "read the forwarding address, then write through it" atomic rather than a
// race against the next rekey.
async function resolveDraftKey(
  store: IDBObjectStore,
  scope: DraftScope,
): Promise<{ key: string; record: DraftRecord | null } | null> {
  const key = draftKey(scope);
  const record = await promisifyRequest(
    store.get(key) as IDBRequest<StoredDraftRecord | undefined>,
  );

  if (!record) return { key, record: null };
  if (!isRedirect(record)) return { key, record };
  if (record.redirectTo === null) return null;

  const movedKey = draftKey({ ...scope, visitId: record.redirectTo });
  const moved = await promisifyRequest(
    store.get(movedKey) as IDBRequest<StoredDraftRecord | undefined>,
  );

  // A forwarding address pointing at another one cannot happen (see
  // DraftRedirectRecord), so one is read as "nothing stored there" rather
  // than followed a second time.
  return { key: movedKey, record: moved && !isRedirect(moved) ? moved : null };
}

// `version` belongs to the caller's payload shape, not to this store: a record
// written under a different one is dropped rather than half-read, which is what
// keeps a future change to the draft shape from having to migrate anything.
//
// Reads through a forwarding address as well as writing through one: a rep who
// comes back to the pre-rekey URL should find their report where they left it,
// not an empty form beside it.
export function readDraft(
  scope: DraftScope,
  version: number,
): Promise<unknown> {
  return runOnFieldDatabase<unknown>(null, async (database) => {
    const store = database
      .transaction(DRAFT_STORE, "readonly")
      .objectStore(DRAFT_STORE);
    const resolved = await resolveDraftKey(store, scope);

    if (!resolved?.record || resolved.record.version !== version) return null;

    return resolved.record.payload;
  });
}

export function writeDraft(
  scope: DraftScope,
  payload: unknown,
  version: number,
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const resolved = await resolveDraftKey(store, scope);

    // Dropped rather than stored: this scope belongs to a visit that was
    // abandoned before it ever existed, and the only thing still writing to
    // it is a screen on its way out.
    if (!resolved) {
      await commitTransaction(transaction);

      return false;
    }

    const record: DraftRecord = {
      key: resolved.key,
      updatedAt: Date.now(),
      version,
      payload,
    };

    store.put(record);

    await commitTransaction(transaction);

    return true;
  });
}

// A draft that outlives its report is swept by age anyway, so a device that
// cannot delete now is not worth holding the caller for.
//
// Deletes through a forwarding address, and leaves the address itself in
// place: the form that asked for this delete is still mounted on the old id
// and will write again as it unmounts, and that write has to keep landing
// where this delete just ran rather than resurrecting a draft under an id
// nothing will ever navigate to again.
export function deleteDraft(scope: DraftScope): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      const store = transaction.objectStore(DRAFT_STORE);
      const resolved = await resolveDraftKey(store, scope);

      if (resolved) store.delete(resolved.key);

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// Closes a scope for good: the draft goes, and what stays behind is a
// forwarding address that leads nowhere, so a write already scheduled against
// this scope is dropped instead of recreating what was just thrown away.
//
// The one caller is abandon-visit-start.ts. Abandoning happens *from* the
// report screen as often as from the location card, and that screen's own
// unmount write (use-field-report-persistence.ts) cannot be cancelled from
// out here — a plain delete loses that race whenever the rep typed something
// before deciding not to do this visit at all.
export function discardDraft(scope: DraftScope): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      const record: DraftRedirectRecord = {
        key: draftKey(scope),
        updatedAt: Date.now(),
        redirectTo: null,
      };

      transaction.objectStore(DRAFT_STORE).put(record);

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// Moves a draft from one visit id to another inside one atomic transaction —
// get the old record, put it under the new key, leave a forwarding address
// behind, commit. IndexedDB transactions are all-or-nothing, so this never
// leaves a draft under neither key, and nothing here needs a two-phase
// write-new-then-delete-old choreography.
//
// The one caller is a visit started offline that turned out to sync under a
// different id than the device minted (see visit-start-outbox-flush.ts) —
// the *draft* is best-effort there, since it is retypeable convenience state
// unlike the pending media below. The forwarding address is not: it replaces
// the old record rather than sitting beside it, and it is written whether or
// not there was a draft to move, because the form still mounted on the old id
// may not have typed anything yet — and every write it makes from here,
// including the one its unmount always performs, has to find this.
export function rekeyDraft(
  scope: DraftScope,
  toVisitId: string,
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    const store = transaction.objectStore(DRAFT_STORE);
    const fromKey = draftKey(scope);
    const record = await promisifyRequest(
      store.get(fromKey) as IDBRequest<StoredDraftRecord | undefined>,
    );

    if (record && !isRedirect(record)) {
      store.put({
        ...record,
        key: draftKey({ ...scope, visitId: toVisitId }),
      });
    }

    const forwarding: DraftRedirectRecord = {
      key: fromKey,
      updatedAt: Date.now(),
      redirectTo: toVisitId,
    };

    store.put(forwarding);

    await commitTransaction(transaction);

    return true;
  });
}

// Sweeps records nobody came back to. Runs off the `updatedAt` index so an
// untouched device does not walk every record it has ever written.
//
// Best effort throughout: a device that cannot prune still works, it just keeps
// a handful of stale records.
function pruneStore(storeName: string, maxAgeMs: number): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
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
  });
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
//
// Bounded like everything else here, and this is the caller it was bounded for:
// the sign-out navigation waits on this one, so a device whose storage has
// stopped answering must not be able to strand a rep in a session they asked to
// leave. Nothing else is actionable on failure either — the sweep above is the
// backstop.
export function clearDrafts(): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const store = database
        .transaction(DRAFT_STORE, "readwrite")
        .objectStore(DRAFT_STORE);

      await promisifyRequest(store.clear());
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}

// --- Pending media -------------------------------------------------------

// Written the instant a recording stops, before any upload is attempted, so the
// window in which the bytes exist only in memory is as close to zero as it can
// be. Returns false when the device would not take them — private browsing, a
// quota refusal, an old WebView — which the caller has to surface rather than
// swallow: for a convenience draft a silent no-op is right, but here it decides
// whether the rep can safely leave the screen.
export function writePendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
  media: PendingMediaBytes,
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaBytesRecord = {
      key: mediaKey(scope, kind, "bytes"),
      updatedAt: Date.now(),
      ...media,
    };
    const store = transaction.objectStore(MEDIA_STORE);

    store.put(record);
    // Fresh bytes invalidate whatever registration the capture they replace had
    // consumed, and the two are separate records, so nothing else would clear
    // it: a second recording written over the first would be paired with the
    // first one's storage object and uploaded into it. Dropped in this same
    // transaction rather than afterwards, because the caller's next step is a
    // network call — exactly the one that fails here — and a half-applied
    // replacement is the state that produces the mismatch.
    store.delete(mediaKey(scope, kind, "registration"));

    await commitTransaction(transaction);

    return true;
  });
}

// A lightweight existence check for callers that only need to know whether
// bytes are pending, not read them — getKey() skips deserializing the
// (potentially several-megabyte) ArrayBuffer that get() would materialize.
export function hasPendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<boolean> {
  return runOnFieldDatabase<boolean>(false, async (database) => {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const key = await promisifyRequest(
      store.getKey(mediaKey(scope, kind, "bytes")),
    );

    return key !== undefined;
  });
}

export function readPendingMediaBytes(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<PendingMediaBytes | null> {
  return runOnFieldDatabase<PendingMediaBytes | null>(
    null,
    async (database) => {
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
    },
  );
}

// Kept apart from the bytes so recording which registration they consumed costs
// one small write rather than rewriting the whole recording.
//
// The bytes are what matter; losing the id only costs one extra registration on
// the next attempt.
export function writePendingMediaRegistration(
  scope: DraftScope,
  kind: PendingMediaKind,
  objectId: string | null,
): Promise<void> {
  return runOnFieldDatabase<void>(undefined, async (database) => {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const record: MediaRegistrationRecord = {
      key: mediaKey(scope, kind, "registration"),
      updatedAt: Date.now(),
      objectId,
    };

    transaction.objectStore(MEDIA_STORE).put(record);

    await commitTransaction(transaction);
  });
}

export function readPendingMediaRegistration(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<string | null> {
  return runOnFieldDatabase<string | null>(null, async (database) => {
    const store = database
      .transaction(MEDIA_STORE, "readonly")
      .objectStore(MEDIA_STORE);
    const record = await promisifyRequest(
      store.get(mediaKey(scope, kind, "registration")) as IDBRequest<
        MediaRegistrationRecord | undefined
      >,
    );

    return record?.objectId ?? null;
  });
}

// Moves both kinds of pending media (bytes + registration, so up to four
// records) from one visit id to another inside one atomic transaction — same
// shape and the same caller as rekeyDraft above, one call rather than one per
// kind so the caller gets a single all-or-nothing answer instead of having to
// combine two. Unlike the draft, this one is load-bearing rather than
// best-effort: these bytes cannot be recreated, so
// visit-start-outbox-flush.ts only marks a start resolved once this lands.
export function rekeyPendingMedia(
  scope: DraftScope,
  toVisitId: string,
): Promise<boolean> {
  return runOnFieldDatabase(false, async (database) => {
    const transaction = database.transaction(MEDIA_STORE, "readwrite");
    const store = transaction.objectStore(MEDIA_STORE);
    const toScope = { ...scope, visitId: toVisitId };

    for (const kind of ["audio", "photo"] as const) {
      for (const part of ["bytes", "registration"] as const) {
        const fromKey = mediaKey(scope, kind, part);
        const record = await promisifyRequest(
          store.get(fromKey) as IDBRequest<
            MediaBytesRecord | MediaRegistrationRecord | undefined
          >,
        );

        if (record) {
          store.put({ ...record, key: mediaKey(toScope, kind, part) });
          store.delete(fromKey);
        }
      }
    }

    await commitTransaction(transaction);

    return true;
  });
}

// Swept by age if this does not land, so the confirm redirect that waits on it
// is held for the teardown budget at most.
export function deletePendingMedia(
  scope: DraftScope,
  kind: PendingMediaKind,
): Promise<void> {
  return runOnFieldDatabase<void>(
    undefined,
    async (database) => {
      const transaction = database.transaction(MEDIA_STORE, "readwrite");
      const store = transaction.objectStore(MEDIA_STORE);

      store.delete(mediaKey(scope, kind, "bytes"));
      store.delete(mediaKey(scope, kind, "registration"));

      await commitTransaction(transaction);
    },
    STORAGE_TEARDOWN_TIMEOUT_MS,
  );
}
