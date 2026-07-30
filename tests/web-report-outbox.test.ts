import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enqueueReportConfirm,
  listReportOutbox,
  rejectReportOutboxEntryForVisit,
  rekeyReportOutboxEntry,
  type ReportOutboxScope,
} from "../apps/web/lib/report-outbox";

// The regression this file exists to pin: a confirm queued against a visit
// that was started with no signal, whose start the server then *rejects*. The
// visit it names can never exist, so every flush sends it, is answered
// `VISIT_NOT_FOUND`, and correctly re-queues it as "the start hasn't caught up
// yet" — forever. The rep watches a pending count that can never reach zero
// and is told nothing about why.
//
// See tests/web-offline-drafts.test.ts for why these stores are exercised
// against a real IndexedDB rather than a pure slice of themselves.

function scopeFor(suffix: string): ReportOutboxScope {
  return { tenantSlug: "acme", userId: `user-${suffix}` };
}

async function entryFor(scope: ReportOutboxScope) {
  const entries = await listReportOutbox(scope);

  assert.equal(entries.length, 1);

  return entries[0];
}

describe("report outbox", () => {
  it("marks the confirm of a start the server refused, rather than leaving it sending forever", async () => {
    const scope = scopeFor("rejected-start");

    await enqueueReportConfirm(scope, "client-visit-1", "request-1", {
      summary: "done",
    });
    await rejectReportOutboxEntryForVisit(
      scope,
      "client-visit-1",
      "Visit type is required.",
    );

    const entry = await entryFor(scope);

    assert.notEqual(entry.rejectedAt, null);
    assert.equal(entry.lastError, "Visit type is required.");
    // Marked, never deleted: this is a report the rep already finished and
    // signed off, and the manual "send now" still retries it.
    assert.deepEqual(entry.payload, { summary: "done" });
  });

  it("does nothing when the refused start had no confirm queued against it", async () => {
    const scope = scopeFor("no-confirm");

    await rejectReportOutboxEntryForVisit(scope, "client-visit-2", "Bad.");

    assert.deepEqual(await listReportOutbox(scope), []);
  });

  it("rekeys a queued confirm onto the resolved visit id, clearing an earlier refusal", async () => {
    // The manual retry path: the rejected start is resent, succeeds this
    // time, and rekeys its confirm. The reason that confirm was marked no
    // longer exists — leaving the mark would keep a report the server will
    // now accept out of every automatic flush.
    const scope = scopeFor("rekey");

    await enqueueReportConfirm(scope, "client-visit-3", "request-3", {
      summary: "done",
    });
    await rejectReportOutboxEntryForVisit(scope, "client-visit-3", "Bad.");
    await rekeyReportOutboxEntry(scope, "client-visit-3", "visit-real-3");

    const entry = await entryFor(scope);

    assert.equal(entry.visitId, "visit-real-3");
    assert.equal(entry.rejectedAt, null);
    assert.equal(entry.lastError, null);
    // The idempotency token survives the move, so the server still recognises
    // a replay of this exact confirm.
    assert.equal(entry.clientRequestId, "request-3");
  });
});
