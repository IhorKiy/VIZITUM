import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideVisitStartFlushAction } from "../apps/web/lib/visit-start-outbox-flush";
import type { VisitStartOutboxEntry } from "../apps/web/lib/visit-start-outbox";

// The regression this file exists to pin: a queued start whose create has
// already reached the server (`remoteVisitId` set) must never be re-sent,
// even if the local rekey that follows it hasn't landed. Re-sending is safe
// for a plain create (the backend's own clientVisitId lookup returns the
// identical row) but not for an adopt outcome, which never stores
// clientVisitId anywhere — a second send re-derives the route slot's state
// fresh, and finding the adopted visit closed in the meantime would mint a
// new, unwanted, unlinked visit instead of recognizing the one already
// adopted.

function entry(
  overrides: Partial<VisitStartOutboxEntry> = {},
): VisitStartOutboxEntry {
  return {
    key: "acme|user-1|client-visit-1",
    clientVisitId: "client-visit-1",
    tenantSlug: "acme",
    userId: "user-1",
    locationId: "location-1",
    routeItemId: "route-item-1",
    visitType: "field_visit",
    startedAt: "2026-07-30T08:00:00.000Z",
    createdAt: 1_753_800_000_000,
    attempts: 0,
    lastError: null,
    rejectedAt: null,
    remoteVisitId: null,
    resolvedVisitId: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("decideVisitStartFlushAction", () => {
  it("sends a start the server has never answered", () => {
    assert.deepEqual(decideVisitStartFlushAction(entry()), { kind: "send" });
  });

  it("retries only the rekey once the server has already answered, never resending", () => {
    // The core regression case: resolvedVisitId is still null (the rekey
    // didn't land last time), but remoteVisitId proves the create already
    // succeeded — a second createVisit call must not happen.
    assert.deepEqual(
      decideVisitStartFlushAction(entry({ remoteVisitId: "visit-real-1" })),
      { kind: "rekeyOnly", remoteVisitId: "visit-real-1" },
    );
  });

  it("skips a fully resolved entry regardless of remoteVisitId", () => {
    assert.deepEqual(
      decideVisitStartFlushAction(
        entry({
          remoteVisitId: "visit-real-1",
          resolvedVisitId: "visit-real-1",
          resolvedAt: 1_753_800_200_000,
        }),
      ),
      { kind: "skip" },
    );
  });

  it("skips a resolved entry even when remoteVisitId was never set", () => {
    // markVisitStartOutboxResolved backfills remoteVisitId whenever it's
    // still null, but that's a write-time guarantee — it says nothing about
    // a record already resolved before this backfill existed, which reads
    // back with resolvedVisitId set and remoteVisitId genuinely null. This
    // must still skip, not fall through to "send": resolvedVisitId alone is
    // enough to know the start already succeeded.
    assert.deepEqual(
      decideVisitStartFlushAction(
        entry({
          resolvedVisitId: "visit-real-1",
          resolvedAt: 1_753_800_200_000,
        }),
      ),
      { kind: "skip" },
    );
  });

  it("skips a rejected entry by default", () => {
    assert.deepEqual(
      decideVisitStartFlushAction(
        entry({ rejectedAt: 1_753_800_100_000, lastError: "Bad Request" }),
      ),
      { kind: "skip" },
    );
  });

  it("resends a rejected entry when the caller asks to include it", () => {
    // A genuine rejection never reaches sendOne with a remoteVisitId already
    // set (see visit-start-outbox-flush.ts's flushVisitStartOutbox), so
    // retrying it always means a fresh send.
    assert.deepEqual(
      decideVisitStartFlushAction(
        entry({ rejectedAt: 1_753_800_100_000, lastError: "Bad Request" }),
        { includeRejected: true },
      ),
      { kind: "send" },
    );
  });
});
