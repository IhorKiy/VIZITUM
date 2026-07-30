"use client";

import { useEffect, useRef, useState } from "react";

import {
  FIELD_REPORT_DRAFT_VERSION,
  isEmptyFieldReportDraft,
  parseFieldReportDraft,
  type FieldReportDraft,
} from "./field-report-draft";
import {
  deleteDraft,
  pruneDrafts,
  prunePendingMedia,
  readDraft,
  readPendingMediaBytes,
  readPendingMediaRegistration,
  writeDraft,
  type DraftScope,
  type PendingMediaKind,
} from "./offline-drafts";

// Keeping an unconfirmed report and its unsent captures on the phone, as hooks
// the report form calls rather than effects living inside it. A rep works
// through stops with no signal, and before this existed a reload, a killed tab
// or the OS reclaiming a backgrounded browser took the whole report with it.
//
// Out of the form because it had grown past 1,800 lines with two unrelated jobs
// in it — the report screen, and a storage layer whose rules (when a draft may
// be written, when it may be read back over, when it is closed for good) are
// only correct in a particular order. Those rules are what this file is; the
// form keeps the fields.
//
// Storage failures stay silent by design: a draft is a safety net, and a net
// that throws is worse than no net.

// Long enough that a burst of typing is one write, short enough that what the
// rep loses to a phone dying mid-sentence is the sentence, not the report.
const DRAFT_WRITE_DEBOUNCE_MS = 500;

type FieldReportDraftOptions = {
  scope: DraftScope;
  // The form's current state, in draft shape. Read on every change, so the
  // caller should memoize it.
  draft: FieldReportDraft;
  // Today, in the form's own local-date format. Passed in rather than computed
  // here because it is what separates a prefilled visit date from a chosen one,
  // and the form owns that field's default.
  today: () => string;
  // Applies a stored draft to the form. Only ever called once, and only when
  // the rep has not started typing.
  onRestore: (draft: FieldReportDraft) => void;
};

export type FieldReportDraftState = {
  // Whether a stored draft was put back, so the screen can say so.
  restored: boolean;
  // Called once the report is on the server: stops every writer above and
  // deletes the draft. Awaited by the caller, because the redirect that follows
  // would otherwise cut the delete short and leave the draft behind.
  close: () => Promise<void>;
};

export function useFieldReportDraft({
  scope,
  draft,
  today,
  onRestore,
}: FieldReportDraftOptions): FieldReportDraftState {
  const [restored, setRestored] = useState(false);
  // Nothing may be written before the stored draft has been read, or an empty
  // first render would delete the very report we are about to restore.
  const loadedRef = useRef(false);
  const storedRef = useRef(false);
  // Set once the report is confirmed. Without it the flush that runs when the
  // screen unmounts would write the draft straight back after the delete, and
  // the redirect makes that unmount immediate.
  const closedRef = useRef(false);
  // The callbacks and the current draft are read from refs so the effects below
  // depend on the scope alone. A render-identity change in `onRestore` must not
  // re-run the restore, and the flush must see the newest draft without
  // re-subscribing to `pagehide` on every keystroke.
  const draftRef = useRef(draft);
  const todayRef = useRef(today);
  const onRestoreRef = useRef(onRestore);

  draftRef.current = draft;
  todayRef.current = today;
  onRestoreRef.current = onRestore;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await readDraft(scope, FIELD_REPORT_DRAFT_VERSION);
      const parsed = stored ? parseFieldReportDraft(stored) : null;

      if (cancelled) return;

      // The read is a single indexed lookup, but a rep who started typing
      // before it landed owns the form — restoring over them would be the very
      // data loss this exists to prevent.
      const untouched = isEmptyFieldReportDraft(
        draftRef.current,
        todayRef.current(),
      );

      if (
        parsed &&
        untouched &&
        !isEmptyFieldReportDraft(parsed, todayRef.current())
      ) {
        onRestoreRef.current(parsed);
        storedRef.current = true;
        setRestored(true);
      }

      loadedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    if (!loadedRef.current || closedRef.current) return;

    if (isEmptyFieldReportDraft(draft, todayRef.current())) {
      // The rep cleared the form back to nothing — leaving the old draft would
      // resurrect it on the next open.
      if (storedRef.current) {
        storedRef.current = false;
        void deleteDraft(scope);
      }
      return;
    }

    const timer = setTimeout(() => {
      storedRef.current = true;
      void writeDraft(scope, draft, FIELD_REPORT_DRAFT_VERSION);
    }, DRAFT_WRITE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draft, scope]);

  // A backgrounded phone is the common way this screen dies, and it does not
  // wait out the debounce — so hiding the page, or leaving it, writes at once.
  useEffect(() => {
    const flush = () => {
      if (!loadedRef.current || closedRef.current) return;

      const current = draftRef.current;

      if (isEmptyFieldReportDraft(current, todayRef.current())) return;

      storedRef.current = true;
      void writeDraft(scope, current, FIELD_REPORT_DRAFT_VERSION);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flush);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [scope]);

  // Opening any visit is as good a moment as any to sweep reports nobody came
  // back to; this screen is the only thing that writes them.
  useEffect(() => {
    void pruneDrafts();
  }, []);

  return {
    restored,
    close: async () => {
      closedRef.current = true;
      storedRef.current = false;

      await deleteDraft(scope);
    },
  };
}

// A capture read back off the device: the bytes as the form wants them, plus
// whichever object registration they had already consumed, so sending again
// re-signs that object instead of registering a second one.
export type RestoredCapture = {
  bytes: ArrayBuffer;
  mimeType: string;
  fileName: string;
  objectId: string | null;
};

type PendingCapturesOptions = {
  scope: DraftScope;
  // Called once, with whichever of the two the device was holding. Not called
  // at all when it was holding neither, so a screen with nothing pending never
  // hears from this hook.
  onRestore: (
    restored: Partial<Record<PendingMediaKind, RestoredCapture>>,
  ) => void;
};

// Bytes the rep captured on a previous visit to this screen and never managed
// to send. The form turns them back into a Blob and a File; this only fetches
// them, because pairing bytes with their registration is a storage rule and
// getting it wrong sends one capture to another one's storage object.
export function usePendingCaptures({
  scope,
  onRestore,
}: PendingCapturesOptions): void {
  const onRestoreRef = useRef(onRestore);

  onRestoreRef.current = onRestore;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [audio, audioObjectId, photo, photoObjectId] = await Promise.all([
        readPendingMediaBytes(scope, "audio"),
        readPendingMediaRegistration(scope, "audio"),
        readPendingMediaBytes(scope, "photo"),
        readPendingMediaRegistration(scope, "photo"),
      ]);

      if (cancelled || !(audio || photo)) return;

      onRestoreRef.current({
        ...(audio ? { audio: { ...audio, objectId: audioObjectId } } : {}),
        ...(photo ? { photo: { ...photo, objectId: photoObjectId } } : {}),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  // Swept here rather than beside the drafts because the two stores keep
  // different retentions, for reasons that belong to each.
  useEffect(() => {
    void prunePendingMedia();
  }, []);
}
