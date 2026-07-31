import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

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
const ownerPassword = normalizeRequired(
  process.env.PLATFORM_OWNER_PASSWORD ||
    (isLocalDatabase ? "Owner12345!" : undefined),
  "PLATFORM_OWNER_PASSWORD",
);

async function main() {
  const passwordHash = await hash(ownerPassword);

  // The second factor is reset alongside the password. A seed that left a
  // stale TOTP secret in place would hand the environment an account nobody
  // holds an authenticator for — and there is no administrator above the
  // platform owner to undo that. Re-seeding therefore returns the account to
  // "must enrol on next sign-in", which is also what makes the e2e suite
  // deterministic.
  const owner = await prisma.platformUser.upsert({
    where: { email: ownerEmail },
    update: {
      name: ownerName,
      passwordHash,
      status: "active",
      totpSecret: null,
      totpConfirmedAt: null,
      totpRecoveryCodeHashes: [],
    },
    create: {
      email: ownerEmail,
      name: ownerName,
      passwordHash,
      status: "active",
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
