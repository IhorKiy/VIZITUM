import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

// Best-effort one-off normalization of stored phone numbers to E.164
// (npm run backfill:phone-e164). For every tenant, each of the three phone
// columns (platformTenant.contactPhone, user.phone, locationContact.phone) is
// re-parsed with the tenant's phoneCountry as context (falling back to the
// tenant's `country` when it is a usable ISO code). Values that parse are
// rewritten to E.164; values that don't are left exactly as they are — legacy
// garbage must never break reads or unrelated updates. Idempotent: E.164
// values re-parse to themselves.

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function normalizeToE164(raw, defaultCountry) {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return null;
  }

  const isInternational = trimmed.startsWith("+");

  if (!isInternational && !defaultCountry) {
    return null;
  }

  const parsed = isInternational
    ? parsePhoneNumberFromString(trimmed)
    : parsePhoneNumberFromString(trimmed, defaultCountry);

  return parsed && parsed.isValid() ? parsed.number : null;
}

function resolvePhoneCountry(tenant) {
  const candidate = (tenant.phoneCountry ?? tenant.country ?? "")
    .trim()
    .toUpperCase();

  // A two-letter code that libphonenumber has no metadata for just makes
  // every parse fail, which is the same outcome as skipping.
  return /^[A-Z]{2}$/.test(candidate) ? candidate : null;
}

async function run() {
  const tenants = await prisma.platformTenant.findMany({
    select: {
      id: true,
      slug: true,
      country: true,
      phoneCountry: true,
      contactPhone: true,
    },
  });

  const totals = { normalized: 0, skipped: 0, empty: 0 };

  for (const tenant of tenants) {
    const phoneCountry = resolvePhoneCountry(tenant);
    const counts = { normalized: 0, skipped: 0 };

    if (tenant.contactPhone) {
      const e164 = normalizeToE164(tenant.contactPhone, phoneCountry);

      if (e164 && e164 !== tenant.contactPhone) {
        await prisma.platformTenant.update({
          where: { id: tenant.id },
          data: { contactPhone: e164 },
        });
        counts.normalized += 1;
      } else if (!e164) {
        counts.skipped += 1;
      }
    }

    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id, phone: { not: null } },
      select: { id: true, phone: true },
    });

    for (const user of users) {
      const e164 = normalizeToE164(user.phone, phoneCountry);

      if (e164 && e164 !== user.phone) {
        await prisma.user.update({
          where: { id: user.id },
          data: { phone: e164 },
        });
        counts.normalized += 1;
      } else if (!e164) {
        counts.skipped += 1;
      }
    }

    const contacts = await prisma.locationContact.findMany({
      where: { tenantId: tenant.id, phone: { not: null } },
      select: { id: true, phone: true },
    });

    for (const contact of contacts) {
      const e164 = normalizeToE164(contact.phone, phoneCountry);

      if (e164 && e164 !== contact.phone) {
        await prisma.locationContact.update({
          where: { id: contact.id },
          data: { phone: e164 },
        });
        counts.normalized += 1;
      } else if (!e164) {
        counts.skipped += 1;
      }
    }

    totals.normalized += counts.normalized;
    totals.skipped += counts.skipped;

    console.log(
      `tenant ${tenant.slug} (phoneCountry=${phoneCountry ?? "none"}): ` +
        `${counts.normalized} normalized, ${counts.skipped} left as-is`,
    );
  }

  console.log(
    `done: ${totals.normalized} normalized, ${totals.skipped} left as-is across ${tenants.length} tenant(s)`,
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
