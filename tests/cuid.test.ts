import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCuid } from "../src/common/cuid";

// `createCuid` exists so a batched insert can know its rows' ids before it
// writes them — `applyLocationsImport` mints them rather than reading them back
// out of `createManyAndReturn`, whose returned order is a Postgres behaviour
// rather than a Prisma guarantee (audit F8's apply, and the review of it).
//
// These ids go into the same column as the ones Prisma's own `@default(cuid())`
// produces, in the same table, so the shape has to match exactly rather than
// merely be unique. The reference values below were taken from ids Prisma
// actually generated against a real database:
//
//     cmsh8kglk0001rk8of90ickws
//     cmsh8kglk0002rk8onj6jmap9
//
// which is: "c", an 8-character base36 millisecond timestamp, a 4-character
// counter, a 4-character per-process fingerprint, and 8 random characters.

const PRISMA_CUID = /^c[0-9a-z]{24}$/;

describe("createCuid", () => {
  it("matches the shape Prisma's own @default(cuid()) produces", () => {
    const id = createCuid();

    assert.equal(id.length, 25);
    assert.match(id, PRISMA_CUID);
  });

  it("carries the current time in its timestamp block", () => {
    // Base36 milliseconds, so an id minted now sorts beside the ones Prisma
    // minted now — the column stays roughly time-ordered, as it was before.
    const before = Date.now().toString(36);
    const id = createCuid();
    const timestamp = id.slice(1, 9);

    assert.equal(timestamp.length, 8);
    // Same millisecond or a few later; comparing base36 strings of equal
    // length is the same as comparing the numbers.
    assert.ok(timestamp >= before, `${timestamp} should not predate ${before}`);
  });

  it("keeps one fingerprint for the process and varies the random block", () => {
    const first = createCuid();
    const second = createCuid();

    // Two processes writing the same table in the same millisecond are told
    // apart here; two ids from *this* process must not be.
    assert.equal(first.slice(13, 17), second.slice(13, 17));
    assert.notEqual(first.slice(17), second.slice(17));
  });

  it("advances the counter, so ids minted in one millisecond still differ", () => {
    // The case that matters: a thousand-row import mints its ids in a tight
    // loop, so the timestamp block is identical across most of them and the
    // counter is the only thing separating them from each other.
    const first = createCuid();
    const second = createCuid();

    assert.notEqual(first.slice(9, 13), second.slice(9, 13));
    assert.ok(
      second.slice(9, 13) > first.slice(9, 13),
      "counter should advance",
    );
  });

  it("mints a full import's worth of ids without a collision", () => {
    // MAX_IMPORT_ROWS is 1 000; 5 000 is comfortably past the largest batch
    // this can be asked for, and past a single millisecond.
    const ids = new Set(Array.from({ length: 5_000 }, () => createCuid()));

    assert.equal(ids.size, 5_000);

    for (const id of ids) {
      assert.match(id, PRISMA_CUID);
    }
  });
});
