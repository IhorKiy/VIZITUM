// Abandoning a visit the server has never heard of — the rep tapped "start"
// with no signal, then decided not to visit this stop after all.
//
// Deliberately not a variant of CancelVisitModal, and not because the UI is
// smaller: there is no visit to cancel. Nothing was ever created, so there is
// no request to send, no reason worth collecting (nobody will ever read one
// about a visit that never existed anywhere but here), and nothing for a
// manager to see change. The whole operation is a delete of what this device
// was holding on the visit's behalf.
//
// What makes it more than a delete is timing. The start queue flushes in the
// background — report-outbox-indicator.tsx on every app-open/online/visible,
// and pending-visit-report.tsx's own 15s poll while the rep sits on that
// screen — so between the render that offered this control and the tap that
// takes it, the very start being abandoned may already have reached the
// server. Dropping the local record then would strand a real `in_progress`
// visit that nobody ever confirms or cancels: the same dead end abandoning
// exists to close, just arrived at from the other side. So the entry is
// re-read here rather than trusted from the render, and a start that resolved
// in the meantime hands the rep to the real visit instead, where the ordinary
// cancel flow (reason and all) already lives.
//
// The narrower window — a create already in flight when the delete lands —
// closes itself without any tombstone: the flush's own `resolveVisitStart`
// only ever *patches* an existing record, so it finds nothing to write back,
// and the visit the server did create shows up on the location card as an
// ordinary "Continue visit" on the next render, cancellable the normal way.

import {
  deleteDraft,
  deletePendingMedia,
  hasPendingMediaBytes,
  type DraftScope,
} from "./offline-drafts";
import {
  deleteReportOutboxEntryForVisit,
  hasReportOutboxEntryForVisit,
} from "./report-outbox";
import {
  deleteVisitStartOutboxEntry,
  getVisitStartOutboxEntry,
  type VisitStartOutboxEntry,
  type VisitStartOutboxScope,
} from "./visit-start-outbox";

export type AbandonVisitStartDecision =
  // Purely local: nothing about this start ever reached the server, so
  // deleting what the device holds is the whole operation.
  | { kind: "abandon" }
  // The start synced while the rep was deciding. The device's copies have
  // already been rekeyed onto this id by visit-start-outbox-flush.ts, so
  // deleting them here would destroy a real visit's work; the rep goes to
  // that visit and cancels it properly instead.
  | { kind: "synced"; visitId: string }
  // No queued start under this id at all — abandoned already, swept, or a
  // link into another device's session. Nothing to do, and nothing to warn
  // about.
  | { kind: "gone" };

// Pure, so the rule stays testable without a browser: what a queue entry's
// state means for whether abandoning it is still a local-only operation.
//
// A *rejected* entry counts as abandonable, not as synced: the server refused
// the create, so there is still no visit anywhere, and the rep is entitled to
// clear the failure rather than carry it. A real visit exists once either
// `resolvedVisitId` (every rekey the flush owns has landed) or `remoteVisitId`
// (the server has answered, but that rekey hasn't finished yet — see
// visit-start-outbox-flush.ts) is set; either one means deleting this entry
// would strand a real visit rather than abandon a local-only one.
export function decideAbandonVisitStart(
  entry: VisitStartOutboxEntry | null,
): AbandonVisitStartDecision {
  if (!entry) return { kind: "gone" };

  const syncedVisitId = entry.resolvedVisitId ?? entry.remoteVisitId;

  if (syncedVisitId) {
    return { kind: "synced", visitId: syncedVisitId };
  }

  return { kind: "abandon" };
}

// What abandoning would throw away, for the confirmation prompt — the same
// two questions CancelVisitModal asks before cancelling a real visit, and in
// the same order of severity: a report the rep already signed off outranks a
// bare recording, because losing a finished report costs more than losing an
// input to one.
//
// The draft (typed but never confirmed) is not reported on, for the same
// reason it is not reported on there: it is retypeable, and warning about it
// would put the least costly loss in the same sentence as the most.
export async function readAbandonVisitStartImpact(
  scope: VisitStartOutboxScope,
  clientVisitId: string,
): Promise<{ report: boolean; media: boolean }> {
  const draftScope: DraftScope = { ...scope, visitId: clientVisitId };
  const [report, audio, photo] = await Promise.all([
    hasReportOutboxEntryForVisit(scope, clientVisitId),
    hasPendingMediaBytes(draftScope, "audio"),
    hasPendingMediaBytes(draftScope, "photo"),
  ]);

  return { report, media: audio || photo };
}

export async function abandonVisitStart(
  scope: VisitStartOutboxScope,
  clientVisitId: string,
): Promise<AbandonVisitStartDecision> {
  const entry = await getVisitStartOutboxEntry(scope, clientVisitId);
  const decision = decideAbandonVisitStart(entry);

  if (!entry || decision.kind !== "abandon") return decision;

  // The queue entry goes first and on its own, rather than in the batch
  // below, because it is the only one of these that can still become a visit
  // on the server. Everything after it is bytes this device is holding, which
  // both sweeps would reclaim on their own schedule anyway — so if storage
  // stops answering halfway through this, the half that already ran is the
  // half that mattered.
  await deleteVisitStartOutboxEntry(entry.key);

  const draftScope: DraftScope = { ...scope, visitId: clientVisitId };

  // Awaited, not fired: every caller navigates the moment this resolves, and
  // an unawaited delete loses that race the same way field-menu.tsx's
  // sign-out clear would. All four are independent transactions, so they run
  // together rather than in sequence.
  //
  // The draft delete is the one best-effort member of the batch. Abandoning
  // from the location card lands cleanly — nothing has the draft open there.
  // Abandoning from the report screen races that screen's own unmount flush
  // (use-field-report-persistence.ts writes the draft back as the form goes
  // away, and cannot be told from outside that its visit just stopped
  // existing), so a rep who typed something before abandoning can leave one
  // inert copy behind under an id nothing will ever navigate to again —
  // swept after 14 days like any other stale draft. Same structural cause as
  // the rekey-orphan noted in the plan doc, and the same non-consequence.
  await Promise.all([
    deleteDraft(draftScope),
    deletePendingMedia(draftScope, "audio"),
    deletePendingMedia(draftScope, "photo"),
    deleteReportOutboxEntryForVisit(scope, clientVisitId),
  ]);

  return decision;
}
