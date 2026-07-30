import { confirmFieldReportAction } from "./field-report-actions";
import {
  deleteReportOutboxEntry,
  listReportOutbox,
  recordReportOutboxFailure,
  type ReportOutboxEntry,
  type ReportOutboxScope,
} from "./report-outbox";
import {
  classifyReportSendResult,
  outcomeForThrownSend,
  type ReportSendOutcome,
} from "./report-send-outcome";

export type ReportOutboxState = {
  // Waiting for signal, and will go out on their own.
  pending: number;
  // Refused by the server. These need the rep to reopen the visit — no amount of
  // retrying will move them.
  needsAttention: number;
  // The session expired mid-flush. Sending is paused rather than hammering a
  // dead session, and the rep has to be told instead of watching a stuck count.
  signInRequired: boolean;
};

export const EMPTY_OUTBOX_STATE: ReportOutboxState = {
  pending: 0,
  needsAttention: 0,
  signInRequired: false,
};

function summarize(
  entries: ReportOutboxEntry[],
  signInRequired: boolean,
): ReportOutboxState {
  return {
    pending: entries.filter((entry) => entry.rejectedAt === null).length,
    needsAttention: entries.filter((entry) => entry.rejectedAt !== null).length,
    signInRequired,
  };
}

async function sendOne(entry: ReportOutboxEntry): Promise<ReportSendOutcome> {
  try {
    return classifyReportSendResult(
      await confirmFieldReportAction(
        entry.visitId,
        entry.payload,
        entry.clientRequestId,
      ),
    );
  } catch {
    // With no network the Server Action's own request throws before any of
    // api-client's handling runs, so this is the ordinary offline path rather
    // than an exceptional one.
    return outcomeForThrownSend();
  }
}

// Drains the queue oldest first, one at a time.
//
// Sequential on purpose: these are the rep's own reports for their own visits,
// there are a handful at most, and firing them together on the thin signal that
// just came back is how you turn one recovered connection into several failures.
//
// `includeRejected` is the manual "send now" — the rep explicitly asking to try
// something the server already refused, which is their call to make.
export async function flushReportOutbox(
  scope: ReportOutboxScope,
  { includeRejected = false }: { includeRejected?: boolean } = {},
): Promise<ReportOutboxState> {
  const queued = await listReportOutbox(scope);
  let signInRequired = false;

  for (const entry of queued) {
    if (entry.rejectedAt !== null && !includeRejected) continue;

    const outcome = await sendOne(entry);

    if (outcome.kind === "sent") {
      await deleteReportOutboxEntry(entry.key);
      continue;
    }

    if (outcome.kind === "signInRequired") {
      // Everything behind this would fail the same way, so stop rather than
      // burning the rest of the queue's attempt counters on a dead session.
      await recordReportOutboxFailure(entry.key, "unauthenticated");
      signInRequired = true;
      break;
    }

    if (outcome.kind === "rejected") {
      await recordReportOutboxFailure(entry.key, outcome.message, true);
      continue;
    }

    // Queued: no signal, or a server-side failure a retry may outlive. Recording
    // the attempt and moving on — the next item may be for a different visit and
    // could still succeed.
    await recordReportOutboxFailure(entry.key, "unsent");
  }

  return summarize(await listReportOutbox(scope), signInRequired);
}

export async function readReportOutboxState(
  scope: ReportOutboxScope,
): Promise<ReportOutboxState> {
  return summarize(await listReportOutbox(scope), false);
}
