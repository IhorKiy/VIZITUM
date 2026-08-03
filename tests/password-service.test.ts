import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hash, needsRehash } from "argon2";

import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_HASH_OPTIONS,
  PasswordService,
} from "../src/modules/auth/password.service";

// Item 3.6 of the security remediation plan: explicit argon2id parameters
// (rather than whatever the library's own defaults happen to be) plus
// rehash-on-login, so a dependency bump can't silently change hashing cost
// and an account hashed under older parameters is upgraded the next time its
// owner signs in rather than never.
describe("PasswordService", () => {
  it("hashes and verifies a password under the pinned parameters", async () => {
    const service = new PasswordService();
    const hashValue = await service.hashPassword("correct horse battery staple");

    // The parameters are encoded in the hash string itself — this is what
    // makes them checkable at all without reaching into argon2 internals.
    assert.match(hashValue, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    assert.equal(
      await service.verifyPassword(hashValue, "correct horse battery staple"),
      true,
    );
    assert.equal(await service.verifyPassword(hashValue, "wrong"), false);
  });

  it("needs no rehash for a hash already under the pinned parameters", async () => {
    const service = new PasswordService();
    const hashValue = await service.hashPassword("a real password");

    assert.equal(await service.rehashIfNeeded(hashValue, "a real password"), null);
  });

  it("rehashes a password stored under different parameters", async () => {
    const service = new PasswordService();
    const password = "a real password";
    // Stands in for a hash created before PASSWORD_HASH_OPTIONS existed (the
    // library's own defaults) or before some future change to it.
    const staleHash = await hash(password, {
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    assert.equal(needsRehash(staleHash, PASSWORD_HASH_OPTIONS), true);

    const rehashed = await service.rehashIfNeeded(staleHash, password);

    assert.notEqual(rehashed, null);
    assert.match(rehashed as string, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    // The upgraded hash verifies against the same password and needs no
    // further rehash — otherwise every login would rehash forever.
    assert.equal(await service.verifyPassword(rehashed as string, password), true);
    assert.equal(needsRehash(rehashed as string, PASSWORD_HASH_OPTIONS), false);
  });

  // Item 3.1 (login timing equalization) verifies the not-found/inactive
  // login path against DUMMY_PASSWORD_HASH so it costs the same as a real
  // account rejected on password. That only holds if the dummy hash costs
  // the same as a *real* hash — i.e. was generated under this same
  // PASSWORD_HASH_OPTIONS, not left at whatever the library defaults were
  // when it was created. A future change to PASSWORD_HASH_OPTIONS without
  // regenerating the dummy hash would silently reopen the timing gap 3.1
  // exists to close, just with the sign flipped — this is the one place that
  // drift is checked.
  it("keeps the dummy login-timing hash under the currently pinned parameters", () => {
    assert.equal(needsRehash(DUMMY_PASSWORD_HASH, PASSWORD_HASH_OPTIONS), false);
  });
});
