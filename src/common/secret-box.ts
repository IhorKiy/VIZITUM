import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Authenticated encryption for the few secrets that have to be stored
// *recoverable* rather than hashed. A TOTP secret is the case this exists
// for: verifying a code requires the secret itself, so unlike a password it
// cannot be one-way hashed, and a database dump or read replica otherwise
// hands over a permanent code generator for the account that reaches every
// tenant's data.
//
// AES-256-GCM: the tag makes a tampered ciphertext fail loudly instead of
// decrypting to rubbish that would then be compared against a code.
const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * A key parsed from configuration, or `null` when none is configured.
 *
 * Null is a real state rather than an error: local development and the test
 * suite run without one, and the production bootstrap gate
 * (`security-config.ts`) is what makes its absence impossible where it
 * matters.
 */
export type SecretKey = Buffer | null;

export function resolveSecretKey(raw: string | undefined): SecretKey {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return null;
  }

  const decoded = decodeKey(trimmed);

  if (!decoded || decoded.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_BYTES} bytes, base64 or hex encoded.`,
    );
  }

  return decoded;
}

export function isSecretKeyValid(raw: string | undefined): boolean {
  try {
    return resolveSecretKey(raw) !== null;
  } catch {
    return false;
  }
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * Versioned because the alternative is a column whose format nobody can
 * change later: a second version can be introduced knowing exactly which
 * rows are which, and `isEncrypted` can tell a stored ciphertext from a
 * value written before this existed.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${ENVELOPE_VERSION}.`);
}

/**
 * Returns the plaintext for an envelope, and the value unchanged for anything
 * written before encryption existed.
 *
 * Passing legacy plaintext through rather than rejecting it is what lets an
 * already-enrolled account keep signing in through the deploy that turns
 * encryption on; `scripts/encrypt-totp-secrets.mjs` and the re-encrypt on
 * next use are what stop that being permanent.
 */
export function decryptSecret(value: string, key: SecretKey): string {
  if (!isEncrypted(value)) {
    return value;
  }

  if (!key) {
    throw new Error(
      "Stored value is encrypted but no encryption key is configured.",
    );
  }

  const [, iv, tag, ciphertext] = value.split(".");

  if (!iv || !tag || !ciphertext) {
    throw new Error("Encrypted value is malformed.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Encrypts when a key is configured, and leaves the value alone when not. */
export function protectSecret(plaintext: string, key: SecretKey): string {
  return key ? encryptSecret(plaintext, key) : plaintext;
}

function decodeKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length === KEY_BYTES * 2) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");

  // Buffer.from ignores anything it cannot decode rather than failing, so a
  // round trip is the only way to know the input was really base64.
  return decoded.length > 0 &&
    equalBytes(Buffer.from(decoded.toString("base64"), "base64"), decoded)
    ? decoded
    : null;
}

function equalBytes(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
