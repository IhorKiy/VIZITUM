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
  rekeyReportOutboxEntry,
  type ReportOutboxScope,
} from "./report-outbox";
import { createVisitAction } from "./visit-start-actions";
import {
  listVisitStartOutbox,
  markVisitStartOutboxResolved,
  recordVisitStartOutboxFailure,
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
// is left exactly as it was, and the next flush cycle replays createVisit
// with the same clientVisitId, hits the backend's own idempotent replay
// branch, gets the identical result at zero cost, and tries the rekey again.
// Retry-until-success for free, rather than a new counter/backoff.
async function resolveVisitStart(
  scope: VisitStartOutboxScope,
  entry: VisitStartOutboxEntry,
  resolvedVisitId: string,
): Promise<void> {
  const draftScope: DraftScope = {
    tenantSlug: scope.tenantSlug,
    userId: scope.userId,
    visitId: entry.clientVisitId,
  };
  const outboxScope: ReportOutboxScope = {
    tenantSlug: scope.tenantSlug,
    userId: scope.userId,
  };

  void rekeyDraft(draftScope, resolvedVisitId);

  const [mediaRekeyed, confirmRekeyed] = await Promise.all([
    rekeyPendingMedia(draftScope, resolvedVisitId),
    rekeyReportOutboxEntry(outboxScope, entry.clientVisitId, resolvedVisitId),
  ]);

  if (mediaRekeyed && confirmRekeyed) {
    await markVisitStartOutboxResolved(entry.key, resolvedVisitId);
  }
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
    if (entry.resolvedVisitId !== null) continue;
    if (entry.rejectedAt !== null && !includeRejected) continue;

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
