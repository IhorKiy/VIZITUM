import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const connectionString = normalizeRequired(
  process.env.DATABASE_URL,
  "DATABASE_URL",
);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const ownerEmail = normalizeEmail(
  normalizeRequired(process.env.PLATFORM_OWNER_EMAIL, "PLATFORM_OWNER_EMAIL"),
);
const ownerName = normalizeRequired(
  process.env.PLATFORM_OWNER_NAME || "Vizitum Platform Owner",
  "PLATFORM_OWNER_NAME",
);
const ownerPassword = normalizeRequired(
  process.env.PLATFORM_OWNER_PASSWORD,
  "PLATFORM_OWNER_PASSWORD",
);

async function main() {
  const passwordHash = await hash(ownerPassword);

  const owner = await prisma.platformUser.upsert({
    where: { email: ownerEmail },
    update: {
      name: ownerName,
      passwordHash,
      status: "active",
    },
    create: {
      email: ownerEmail,
      name: ownerName,
      passwordHash,
      status: "active",
    },
    select: { id: true, email: true, name: true, status: true },
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

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}
