import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deleteDraft,
  discardDraft,
  pruneDrafts,
  readDraft,
  rekeyDraft,
  writeDraft,
  type DraftScope,
} from "../apps/web/lib/offline-drafts";

// The regression this file exists to pin: a visit started with no signal
// resolves under the server's own id, the draft is moved onto it — and the
// report form is still mounted on the *old* id, with a debounced write already
// scheduled and one more guaranteed at unmount. Before the forwarding address,
// those writes recreated the draft under an id nothing would ever navigate to
// again: an inert duplicate that only the 14-day sweep cleared.
//
// The first real exercise of these stores outside Playwright. `fake-indexeddb`
// is a devDependency for exactly this: the rules here (what a write follows,
// what a delete removes, what survives a rekey) are storage rules, and the pure
// slice of them that could be tested without a database is the uninteresting
// half.

const VERSION = 1;

// The key layout is duplicated as a literal rather than imported, the same
// trick apps/web/e2e's specs already use from outside the module graph: reading
// the raw record is the only way to tell "the draft moved" from "the draft
// moved and a copy grew back behind it", which is the whole bug.
const KEY_SEPARATOR = "\u0000";

function rawRecord(scope: DraftScope): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // No version: this opens whatever `field-db.ts` already created (every
    // case below touches the store through the module first). Pinning one
    // here would duplicate a number that is meant to change, and the next
    // `DATABASE_VERSION` bump would fail these tests with a `VersionError`
    // that says nothing about what actually broke. The key layout is the
    // only thing worth duplicating.
    const request = indexedDB.open("vizitum-field");

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database
        .transaction("report-drafts", "readonly")
        .objectStore("report-drafts")
        .get(
          [scope.tenantSlug, scope.userId, scope.visitId].join(KEY_SEPARATOR),
        );

      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        database.close();
        resolve(read.result);
      };
    };
  });
}

function scopeFor(visitId: string, suffix: string): DraftScope {
  // A fresh user per case: the stores are shared for the whole file, and a
  // leaked draft would make one test's assertion depend on another's order.
  return { tenantSlug: "acme", userId: `user-${suffix}`, visitId };
}

describe("offline drafts", () => {
  it("round-trips a draft and drops one written under another version", async () => {
    const scope = scopeFor("visit-1", "round-trip");

    assert.equal(await writeDraft(scope, { summary: "typed" }, VERSION), true);
    assert.deepEqual(await readDraft(scope, VERSION), { summary: "typed" });
    assert.equal(await readDraft(scope, VERSION + 1), null);
  });

  it("moves a draft onto the resolved visit id and forwards reads back", async () => {
    const client = scopeFor("client-visit-2", "rekey-read");
    const real = { ...client, visitId: "visit-real-2" };

    await writeDraft(client, { summary: "typed offline" }, VERSION);
    await rekeyDraft(client, "visit-real-2");

    assert.deepEqual(await readDraft(real, VERSION), {
      summary: "typed offline",
    });
    // The rep who is still standing on the pre-rekey URL sees their report,
    // not an empty form beside it.
    assert.deepEqual(await readDraft(client, VERSION), {
      summary: "typed offline",
    });
  });

  it("sends a write from the still-mounted form to the resolved id, leaving no duplicate", async () => {
    const client = scopeFor("client-visit-3", "rekey-write");
    const real = { ...client, visitId: "visit-real-3" };

    await writeDraft(client, { summary: "first" }, VERSION);
    await rekeyDraft(client, "visit-real-3");

    // The keystroke that lands after the rekey — the one that used to
    // resurrect the old key.
    await writeDraft(client, { summary: "second" }, VERSION);

    assert.deepEqual(await readDraft(real, VERSION), { summary: "second" });

    // What is left under the old id is a forwarding address, not a report:
    // the duplicate this whole mechanism exists to prevent would show up here
    // as a record carrying a `payload`.
    const stranded = (await rawRecord(client)) as Record<string, unknown>;

    assert.equal(stranded.redirectTo, "visit-real-3");
    assert.equal("payload" in stranded, false);
  });

  it("forwards writes even when the rekey found nothing to move", async () => {
    // The rep had not typed anything yet when the start resolved. The
    // forwarding address still has to be there, or the first thing they type
    // afterwards lands under the dead id.
    const client = scopeFor("client-visit-4", "rekey-empty");
    const real = { ...client, visitId: "visit-real-4" };

    await rekeyDraft(client, "visit-real-4");
    await writeDraft(client, { summary: "typed after" }, VERSION);

    assert.deepEqual(await readDraft(real, VERSION), {
      summary: "typed after",
    });
  });

  it("deletes through a forwarding address and keeps forwarding afterwards", async () => {
    // The form clearing itself back to empty, or closing after a confirm,
    // has to reach the draft where it actually lives now.
    const client = scopeFor("client-visit-5", "rekey-delete");
    const real = { ...client, visitId: "visit-real-5" };

    await writeDraft(client, { summary: "typed" }, VERSION);
    await rekeyDraft(client, "visit-real-5");
    await deleteDraft(client);

    assert.equal(await readDraft(real, VERSION), null);

    await writeDraft(client, { summary: "typed again" }, VERSION);

    assert.deepEqual(await readDraft(real, VERSION), {
      summary: "typed again",
    });
  });

  it("drops a write that lands after the visit was abandoned", async () => {
    // abandon-visit-start.ts, from the report screen: the form writes the
    // draft back one last time as it unmounts, and there is no visit left for
    // it to belong to.
    const scope = scopeFor("client-visit-6", "abandon");

    await writeDraft(scope, { summary: "typed" }, VERSION);
    await discardDraft(scope);

    assert.equal(await readDraft(scope, VERSION), null);
    assert.equal(await writeDraft(scope, { summary: "unmount" }, VERSION), false);
    assert.equal(await readDraft(scope, VERSION), null);
  });

  it("sweeps a forwarding address by age like any other stale record", async () => {
    const client = scopeFor("client-visit-7", "prune");

    await writeDraft(client, { summary: "typed" }, VERSION);
    await rekeyDraft(client, "visit-real-7");
    // Everything written by this test is younger than the cutoff, so a sweep
    // with a zero window is the only way to assert the record is reachable by
    // `updatedAt` at all — which is what keeps forwarding addresses from
    // accumulating forever on a device that never signs out.
    await pruneDrafts(0);

    assert.equal(await rawRecord(client), undefined);
  });
});
