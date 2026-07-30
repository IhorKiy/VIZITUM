import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideAbandonVisitStart } from "../apps/web/lib/abandon-visit-start";
import type { VisitStartOutboxEntry } from "../apps/web/lib/visit-start-outbox";

// Cancelling a visit that only ever existed on the rep's phone is a local
// delete — but only for as long as that stays true. The start queue flushes in
// the background, so the same entry can become a real, server-known visit
// between the render that offered the control and the tap that takes it. This
// rule is the whole guard against deleting the local record of a visit the
// server has already created: do that and the visit sits `in_progress`
// forever, confirmed by nobody, cancellable by nobody — the exact dead end
// this feature exists to close, reached from the other direction.

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

describe("decideAbandonVisitStart", () => {
  it("abandons a start that has never reached the server", () => {
    assert.deepEqual(decideAbandonVisitStart(entry()), { kind: "abandon" });
  });

  it("abandons a start the server refused", () => {
    // A rejection means the create was answered and declined, so there is
    // still no visit anywhere — the rep is entitled to clear the failure
    // rather than carry it around. (findPendingVisitStartForLocation already
    // excludes these from the location card's "still syncing" state, so this
    // is the report screen's path, which does not.)
    assert.deepEqual(
      decideAbandonVisitStart(
        entry({ rejectedAt: 1_753_800_100_000, lastError: "Bad Request" }),
      ),
      { kind: "abandon" },
    );
  });

  it("refuses to delete anything once the start has synced", () => {
    // The flush sets resolvedVisitId only after every rekey it owns has
    // landed, so by this point the draft, the pending media and any queued
    // confirm all live under the real id — deleting "this visit's" local
    // state here would take a real visit's work with it.
    assert.deepEqual(
      decideAbandonVisitStart(
        entry({ resolvedVisitId: "visit-real-1", resolvedAt: 1_753_800_200_000 }),
      ),
      { kind: "synced", visitId: "visit-real-1" },
    );
  });

  it("refuses to delete anything once the server has answered, even before the rekey lands", () => {
    // remoteVisitId is set the moment createVisit first succeeds — before
    // resolvedVisitId, which waits on the rekey. A real visit already exists
    // at this point, so this must read the same as the fully-synced case
    // above, not as abandonable.
    assert.deepEqual(
      decideAbandonVisitStart(entry({ remoteVisitId: "visit-real-1" })),
      { kind: "synced", visitId: "visit-real-1" },
    );
  });

  it("treats a resolved-then-rejected entry as synced, not abandonable", () => {
    // markVisitStartOutboxResolved clears rejectedAt precisely so this cannot
    // normally happen; the assertion pins the precedence anyway, because
    // reading it the other way round is the one mistake that loses data.
    assert.deepEqual(
      decideAbandonVisitStart(
        entry({ resolvedVisitId: "visit-real-1", rejectedAt: 1_753_800_050_000 }),
      ),
      { kind: "synced", visitId: "visit-real-1" },
    );
  });

  it("does nothing when there is no queued start under this id", () => {
    // A link opened twice, a start already abandoned, or another device's
    // session. Nothing to delete and nothing to warn about.
    assert.deepEqual(decideAbandonVisitStart(null), { kind: "gone" });
  });
});
