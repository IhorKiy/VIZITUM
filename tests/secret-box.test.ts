import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";

import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  isSecretKeyValid,
  protectSecret,
  resolveSecretKey,
} from "../src/common/secret-box";

// A TOTP secret has to be stored recoverable — verifying a code needs the
// secret itself, so unlike a password it cannot be hashed — which is exactly
// why it must not sit in the database in the clear.
describe("secret box", () => {
  const key = randomBytes(32);

  it("round-trips a secret and produces a different envelope each time", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const first = encryptSecret(secret, key);
    const second = encryptSecret(secret, key);

    assert.equal(decryptSecret(first, key), secret);
    assert.equal(decryptSecret(second, key), secret);
    // A fresh IV per write: two encryptions of the same secret must not be
    // recognizable as the same value by looking at the column.
    assert.notEqual(first, second);
    assert.ok(!first.includes(secret));
  });

  it("refuses a tampered envelope instead of returning rubbish", () => {
    // Without the authentication tag a flipped byte would decrypt to
    // something, and that something would then be handed to the code
    // verifier.
    const envelope = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const [version, iv, tag, ciphertext] = envelope.split(".");
    const flipped = [version, iv, tag, flipFirstCharacter(ciphertext)].join(
      ".",
    );

    assert.throws(() => decryptSecret(flipped, key));
    assert.throws(() => decryptSecret(envelope, randomBytes(32)));
  });

  it("passes a value written before encryption existed straight through", () => {
    // This is what lets an already-enrolled owner sign in through the deploy
    // that turns encryption on.
    assert.equal(decryptSecret("JBSWY3DPEHPK3PXP", key), "JBSWY3DPEHPK3PXP");
    assert.equal(decryptSecret("JBSWY3DPEHPK3PXP", null), "JBSWY3DPEHPK3PXP");
    assert.equal(isEncrypted("JBSWY3DPEHPK3PXP"), false);
    assert.equal(isEncrypted(encryptSecret("JBSWY3DPEHPK3PXP", key)), true);
  });

  it("refuses an envelope it has no key for, rather than guessing", () => {
    const envelope = encryptSecret("JBSWY3DPEHPK3PXP", key);

    assert.throws(
      () => decryptSecret(envelope, null),
      /no encryption key is configured/,
    );
  });

  it("encrypts when a key is configured and leaves the value alone when not", () => {
    assert.equal(isEncrypted(protectSecret("JBSWY3DPEHPK3PXP", key)), true);
    assert.equal(protectSecret("JBSWY3DPEHPK3PXP", null), "JBSWY3DPEHPK3PXP");
  });

  it("accepts a 32-byte key as base64 or hex, and nothing else", () => {
    const raw = randomBytes(32);

    assert.deepEqual(resolveSecretKey(raw.toString("base64")), raw);
    assert.deepEqual(resolveSecretKey(raw.toString("hex")), raw);
    assert.equal(resolveSecretKey(undefined), null);
    assert.equal(resolveSecretKey("   "), null);

    // A key of the wrong length is a configuration mistake worth failing on:
    // silently padding or truncating it would produce an encryption everyone
    // believes is 256-bit.
    assert.throws(() => resolveSecretKey(randomBytes(16).toString("base64")));
    assert.throws(() => resolveSecretKey("not a key"));

    assert.equal(isSecretKeyValid(raw.toString("base64")), true);
    assert.equal(isSecretKeyValid(randomBytes(16).toString("hex")), false);
    assert.equal(isSecretKeyValid(undefined), false);
  });
});

function flipFirstCharacter(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
