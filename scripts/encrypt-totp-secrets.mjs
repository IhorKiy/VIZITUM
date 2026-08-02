import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes } from "node:crypto";

// One-time migration for TOTP secrets written before they were encrypted.
//
// The application already reads both forms and re-encrypts a plaintext secret
// the next time its owner signs in, so this script is not required for the
// product to work. It exists because "the next time they sign in" is not a
// deadline anyone controls, and until then the row a database dump exposes is
// still a working code generator.
//
// Safe to run repeatedly: already-encrypted values are skipped. It never
// decrypts, so it cannot damage a row it does not understand.
//
//   TOTP_ENCRYPTION_KEY=... DATABASE_URL=... node scripts/encrypt-totp-secrets.mjs

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

const connectionString = required(process.env.DATABASE_URL, "DATABASE_URL");
const key = parseKey(
  required(process.env.TOTP_ENCRYPTION_KEY, "TOTP_ENCRYPTION_KEY"),
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const [users, challenges] = await Promise.all([
    prisma.platformUser.findMany({
      where: { totpSecret: { not: null } },
      select: { id: true, email: true, totpSecret: true },
    }),
    // Enrolment challenges are short-lived, but an unconsumed one holds a
    // candidate secret in the same clear text.
    prisma.platformMfaChallenge.findMany({
      where: { pendingSecret: { not: null }, consumedAt: null },
      select: { id: true, pendingSecret: true },
    }),
  ]);

  let encryptedUsers = 0;
  let skippedUsers = 0;

  for (const user of users) {
    if (isEncrypted(user.totpSecret)) {
      skippedUsers += 1;
      continue;
    }

    await prisma.platformUser.update({
      where: { id: user.id },
      data: { totpSecret: encrypt(user.totpSecret) },
    });
    encryptedUsers += 1;
    console.log(`Encrypted the TOTP secret for ${user.email}.`);
  }

  let encryptedChallenges = 0;

  for (const challenge of challenges) {
    if (isEncrypted(challenge.pendingSecret)) {
      continue;
    }

    await prisma.platformMfaChallenge.update({
      where: { id: challenge.id },
      data: { pendingSecret: encrypt(challenge.pendingSecret) },
    });
    encryptedChallenges += 1;
  }

  console.log(
    `Done: ${encryptedUsers} secret(s) encrypted, ${skippedUsers} already encrypted, ${encryptedChallenges} pending enrolment secret(s) encrypted.`,
  );
}

function isEncrypted(value) {
  return value.startsWith(`${ENVELOPE_VERSION}.`);
}

function encrypt(plaintext) {
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

function parseKey(raw) {
  const trimmed = raw.trim();
  const decoded =
    /^[0-9a-fA-F]{64}$/.test(trimmed) === true
      ? Buffer.from(trimmed, "hex")
      : Buffer.from(trimmed, "base64");

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `TOTP_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64 or hex encoded.`,
    );
  }

  return decoded;
}

function required(value, name) {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
