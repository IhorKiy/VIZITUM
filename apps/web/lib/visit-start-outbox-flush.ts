import type { Visit } from "./api-client";
import {
  type DraftScope,
  rekeyDraft,
  rekeyPendingMedia,
} from "./offline-drafts";
import {
  classifyReportSendResult,
  outcomeForThrownSend,
  type ReportSendOutcome,
} from "./report-send-outcome";
import {
  rejectReportOutboxEntryForVisit,
  rekeyReportOutboxEntry,
  type ReportOutboxScope,
} from "./report-outbox";
import { createVisitAction } from "./visit-start-actions";
import {
  listVisitStartOutbox,
  markVisitStartOutboxResolved,
  recordVisitStartOutboxFailure,
  recordVisitStartOutboxRemoteVisitId,
  type VisitStartOutboxEntry,
  type VisitStartOutboxScope,
} from "./visit-start-outbox";

export type VisitStartOutboxState = {
  // Waiting for signal, or resolved-but-not-yet-checked — not resolved and
  // not rejected. Unlike report-outbox's "pending", this excludes a third
  // bucket confirms don't have: entries that already succeeded and are being
  // kept as the permanent id mapping (see visit-start-outbox.ts).
  pending: number;
  needsAttention: number;
  signInRequired: boolean;
};

export const EMPTY_VISIT_START_OUTBOX_STATE: VisitStartOutboxState = {
  pending: 0,
  needsAttention: 0,
  signInRequired: false,
};

function summarize(
  entries: VisitStartOutboxEntry[],
  signInRequired: boolean,
): VisitStartOutboxState {
  return {
    pending: entries.filter(
      (entry) => entry.resolvedVisitId === null && entry.rejectedAt === null,
    ).length,
    needsAttention: entries.filter((entry) => entry.rejectedAt !== null).length,
    signInRequired,
  };
}

async function sendOne(entry: VisitStartOutboxEntry): Promise<{
  outcome: ReportSendOutcome;
  // Carried alongside the outcome, not folded into it: classifyReportSendResult
  // was built for confirms, where "sent" needs nothing further. A resolved
  // start needs the server's real id to rekey onto, which only the raw result
  // (not the outcome classification) still has.
  result: { ok: true; data: Visit } | null;
}> {
  try {
    const result = await createVisitAction({
      locationId: entry.locationId,
      representativeUserId: entry.userId,
      visitType: entry.visitType,
      routeItemId: entry.routeItemId ?? undefined,
      startedAt: entry.startedAt,
      clientVisitId: entry.clientVisitId,
    });

    return {
      outcome: classifyReportSendResult(result),
      result: result.ok ? result : null,
    };
  } catch {
    // With no network the Server Action's own request throws before any of
    // api-client's handling runs, same as a confirm attempt — see
    // report-outbox-flush.ts.
    return { outcome: outcomeForThrownSend(), result: null };
  }
}

// Rekeys everything the device knows about this visit from the client-minted
// id to the server's real one, and only then marks the start resolved. The
// draft is best-effort (convenience state); the pending media and any
// already-queued confirm are load-bearing — if either did not land, the entry
// is left exactly as it was, and the next flush cycle retries only this rekey
// (see decideVisitStartFlushAction below) rather than resending the create.
//
// `remoteVisitId` is recorded first and durably, before any rekey is
// attempted, so even a crash mid-rekey leaves the next cycle already knowing
// the server has answered. That ordering is what stops this specific device
// from ever re-sending createVisit for an entry it already got an answer
// for — re-sending is free for a plain create (the backend's own
// clientVisitId lookup returns the identical row) and, since VisitsService
// backfills clientVisitId onto an adopted visit that doesn't have one yet,
// usually free for an adopt outcome too now. What this client-side field
// still guards against is this device never having heard the answer at all
// (a lost response, not a slow rekey) racing a *second* device or retry that
// adopts the same still-open visit first and claims the id slot before this
// one's own backfill can — a second call would then re-derive the route
// slot's state fresh, and finding the adopted visit closed in the meantime
// would mint a new, unwanted, unlinked visit instead of recognizing the one
// already adopted.
async function resolveVisitStart(
  scope: VisitStartOutboxScope,
  entry: VisitStartOutboxEntry,
  resolvedVisitId: string,
): Promise<void> {
  if (entry.remoteVisitId === null) {
    await recordVisitStartOutboxRemoteVisitId(entry.key, resolvedVisitId);
  }

  const draftScope: DraftScope = {
    tenantSlug: scope.tenantSlug,
    userId: scope.userId,
    visitId: entry.clientVisitId,
  };
  const outboxScope: ReportOutboxScope = {
    tenantSlug: scope.tenantSlug,
    userId: scope.userId,
  };

  // The draft's own result is still ignored — it is retypeable convenience
  // state, and holding a start unresolved over one would be the tail wagging
  // the dog. Waited on all the same, rather than fired and forgotten as it
  // once was, because the same call now installs the forwarding address that
  // keeps the report form still mounted on the old id from writing a second
  // copy back under it (see offline-drafts.ts). That has to be in place
  // before the start resolves and this screen redirects, which is exactly
  // when the form unmounts and writes.
  const [, mediaRekeyed, confirmRekeyed] = await Promise.all([
    rekeyDraft(draftScope, resolvedVisitId),
    rekeyPendingMedia(draftScope, resolvedVisitId),
    rekeyReportOutboxEntry(outboxScope, entry.clientVisitId, resolvedVisitId),
  ]);

  if (mediaRekeyed && confirmRekeyed) {
    await markVisitStartOutboxResolved(entry.key, resolvedVisitId);
  }
}

// Pure, so the rule is unit-testable without mocking IndexedDB or the
// network — same split as classifyReportSendResult. This is the whole guard
// against the phantom-replay bug: once the server has answered an entry
// once (`remoteVisitId` set), every later cycle retries only the local rekey
// and never calls createVisit again for it.
export type VisitStartFlushAction =
  | { kind: "send" }
  | { kind: "rekeyOnly"; remoteVisitId: string }
  | { kind: "skip" };

export function decideVisitStartFlushAction(
  entry: VisitStartOutboxEntry,
  { includeRejected = false }: { includeRejected?: boolean } = {},
): VisitStartFlushAction {
  if (entry.resolvedVisitId !== null) return { kind: "skip" };
  if (entry.rejectedAt !== null && !includeRejected) return { kind: "skip" };

  if (entry.remoteVisitId !== null) {
    return { kind: "rekeyOnly", remoteVisitId: entry.remoteVisitId };
  }

  return { kind: "send" };
}

// Drains the queue oldest first, one at a time — same reasoning as
// flushReportOutbox: a handful of stops at most, and firing them together on
// the thin signal that just came back is how one recovered connection turns
// into several failures. Starts are meant to be flushed ahead of confirms by
// the caller (report-outbox-indicator.tsx) — a queued confirm for a visit
// whose start has not synced yet would otherwise reach the server first and
// just re-queue itself anyway (see report-send-outcome.ts's VISIT_NOT_FOUND
// handling), but there is no reason to make it wait a cycle when it does not
// have to.
export async function flushVisitStartOutbox(
  scope: VisitStartOutboxScope,
  { includeRejected = false }: { includeRejected?: boolean } = {},
): Promise<VisitStartOutboxState> {
  const queued = await listVisitStartOutbox(scope);
  let signInRequired = false;

  for (const entry of queued) {
    const action = decideVisitStartFlushAction(entry, { includeRejected });

    if (action.kind === "skip") continue;

    if (action.kind === "rekeyOnly") {
      await resolveVisitStart(scope, entry, action.remoteVisitId);
      continue;
    }

    const { outcome, result } = await sendOne(entry);

    if (outcome.kind === "sent") {
      if (result) await resolveVisitStart(scope, entry, result.data.id);
      continue;
    }

    if (outcome.kind === "signInRequired") {
      // Everything behind this would fail the same way, so stop rather than
      // burning the rest of the queue's attempt counters on a dead session.
      await recordVisitStartOutboxFailure(entry.key, "unauthenticated");
      signInRequired = true;
      break;
    }

    if (outcome.kind === "rejected") {
      await recordVisitStartOutboxFailure(entry.key, outcome.message, true);
      // A rep can confirm a report against a visit that has not synced yet —
      // that confirm sits in the other queue under this same client-minted
      // id, waiting for a visit this rejection has just ruled out for good.
      // Left alone it is sent on every cycle forever, answered
      // `VISIT_NOT_FOUND` every time, and correctly re-queued by
      // report-send-outcome.ts as "the start hasn't caught up yet" — a
      // pending count that can never reach zero, with nothing said about why.
      // Carrying the rejection across makes it say so instead.
      await rejectReportOutboxEntryForVisit(
        scope,
        entry.clientVisitId,
        outcome.message,
      );
      continue;
    }

    // Queued: no signal, or a server-side failure a retry may outlive.
    await recordVisitStartOutboxFailure(entry.key, "unsent");
  }

  return summarize(await listVisitStartOutbox(scope), signInRequired);
}

export async function readVisitStartOutboxState(
  scope: VisitStartOutboxScope,
): Promise<VisitStartOutboxState> {
  return summarize(await listVisitStartOutbox(scope), false);
}
