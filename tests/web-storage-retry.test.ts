import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStorageObjectGone } from "../apps/web/lib/storage-retry";

// The rule a field rep's retry hangs on. A capture that failed to upload is
// held on the device with the storage object it already registered; taking it
// again re-signs that object. This decides when the object cannot be re-signed
// and a new registration is the only way out.

describe("isStorageObjectGone", () => {
  it("treats every verdict about the object itself as gone", () => {
    // The three the storage service can return, all of them a ruling on this
    // id rather than on the request that carried it.
    for (const code of [
      "STORAGE_OBJECT_INVALID",
      "STORAGE_OBJECT_NOT_FOUND",
      "STORAGE_OBJECT_NOT_ACTIVE",
    ]) {
      assert.equal(
        isStorageObjectGone({ status: 400, code }),
        true,
        `expected ${code} to count as gone`,
      );
    }
  });

  it("treats a bare 404 as gone even with no code", () => {
    // A proxy in front of the API can return the status without the body.
    assert.equal(isStorageObjectGone({ status: 404 }), true);
  });

  it("does not treat an unreachable server as a verdict", () => {
    // This is the case the whole distinction exists for: in a dead zone the
    // re-sign gets no answer at all, and reading that as "the object is gone"
    // registers a second one — a duplicate storage object and, for audio, a
    // duplicate VisitNote on the visit, every attempt.
    assert.equal(isStorageObjectGone({ status: 0 }), false);
    assert.equal(isStorageObjectGone({ status: 502 }), false);
    assert.equal(isStorageObjectGone({ status: 503 }), false);
    assert.equal(isStorageObjectGone({ status: 504 }), false);
  });

  it("does not treat an answer about the caller as one about the object", () => {
    // A session that expired while the bytes waited, or a permission answer:
    // the registration is untouched and still re-signable once the rep is back.
    assert.equal(
      isStorageObjectGone({ status: 401, code: "SESSION_EXPIRED" }),
      false,
    );
    assert.equal(
      isStorageObjectGone({ status: 403, code: "MISSING_PERMISSION" }),
      false,
    );
    assert.equal(
      isStorageObjectGone({ status: 400, code: "VALIDATION_FAILED" }),
      false,
    );
  });
});
