import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

// Duplicated from TEXT_LIMITS.password in src/common/input-limits.ts for the
// same reason normalizeEmail below is duplicated: this is a plain node ESM
// script with no build step, and nothing in scripts/ imports the TypeScript
// sources. `tests/input-limits.test.ts` reads this file as text and fails if
// the two numbers drift, which is the only thing keeping the copy honest.
//
// Declared up here rather than beside its helper because the helper runs
// during module evaluation, below — a `const` further down the file would be
// in its temporal dead zone by then.
const MAX_PASSWORD_LENGTH = 128;

const connectionString = normalizeRequired(
  process.env.DATABASE_URL,
  "DATABASE_URL",
);
const isLocalDatabase = isLocalDatabaseUrl(connectionString);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const ownerEmail = normalizeEmail(
  normalizeRequired(
    process.env.PLATFORM_OWNER_EMAIL ||
      (isLocalDatabase ? "owner@platform.local" : undefined),
    "PLATFORM_OWNER_EMAIL",
  ),
);
const ownerName = normalizeRequired(
  process.env.PLATFORM_OWNER_NAME || "Vizitum Platform Owner",
  "PLATFORM_OWNER_NAME",
);
const ownerPassword = normalizePassword(
  normalizeRequired(
    process.env.PLATFORM_OWNER_PASSWORD ||
      (isLocalDatabase ? "Owner12345!" : undefined),
    "PLATFORM_OWNER_PASSWORD",
  ),
  "PLATFORM_OWNER_PASSWORD",
);

// Optional, and only meaningful for automated environments: pre-enrol the
// account against a known TOTP secret so a test suite can act as the
// authenticator app. Unset (the normal case, including local dev) leaves the
// account unenrolled, which is what makes the first sign-in walk the real
// enrolment journey.
const ownerTotpSecret = process.env.PLATFORM_OWNER_TOTP_SECRET?.trim() || null;

async function main() {
  const passwordHash = await hash(ownerPassword);

  // The second factor is reset alongside the password. A seed that left a
  // stale TOTP secret in place would hand the environment an account nobody
  // holds an authenticator for — and there is no administrator above the
  // platform owner to undo that. Re-seeding therefore returns the account to
  // "must enrol on next sign-in", unless PLATFORM_OWNER_TOTP_SECRET pins a
  // known one for an automated environment.
  const owner = await prisma.platformUser.upsert({
    where: { email: ownerEmail },
    update: {
      name: ownerName,
      passwordHash,
      status: "active",
      totpSecret: ownerTotpSecret,
      totpConfirmedAt: ownerTotpSecret ? new Date() : null,
      totpRecoveryCodeHashes: [],
    },
    create: {
      email: ownerEmail,
      name: ownerName,
      passwordHash,
      status: "active",
      totpSecret: ownerTotpSecret,
      totpConfirmedAt: ownerTotpSecret ? new Date() : null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      totpConfirmedAt: true,
    },
  });

  console.log(
    JSON.stringify(
      { message: "platform_owner_seeded", owner },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function normalizeRequired(value, name) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed) {
    throw new Error(`Environment variable ${name} is required.`);
  }

  return trimmed;
}

// Plain node ESM script (no tsx/build step), so it can't import
// src/common/normalize.ts. Must stay trim+lowercase to match it, or a seeded
// owner won't match the email PlatformAuthService normalizes at login.
function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

// Refuses rather than truncates, and refuses *before* the hash is written.
//
// PlatformAuthService.login reads the submitted password through the same cap
// and treats anything longer as no password at all, so a seeded owner past it
// is an account that hashes fine and then answers 401 INVALID_CREDENTIALS
// forever, with the deliberately uniform message that cannot say why. There is
// no administrator above the platform owner to undo that, and the account is
// the one that reaches every tenant's data — so this has to fail loudly at
// seed time, which is the last moment anyone is still looking.
function normalizePassword(value, name) {
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `Environment variable ${name} must be at most ${MAX_PASSWORD_LENGTH} characters ` +
        `(got ${value.length}). The login endpoint rejects anything longer, so seeding ` +
        `this password would create an owner account that can never sign in.`,
    );
  }

  return value;
}

function isLocalDatabaseUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    return (
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      localHosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
