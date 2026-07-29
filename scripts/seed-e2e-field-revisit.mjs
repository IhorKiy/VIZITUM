import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

// Seed for the field-revisit e2e spec: a dedicated tenant with one field
// representative, one assigned location and a published route plan for today
// holding a single planned stop. Re-running resets the stop to "planned" and
// cancels any visits left behind by a previous run, so the spec always starts
// from the same state against the shared local database.
//
// The tenant language is "en" on purpose — the spec matches UI strings from
// apps/web/messages/en.json.

const connectionString = required(process.env.DATABASE_URL, "DATABASE_URL");
assertLocalDatabaseUrl(connectionString);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Parameterized so more than one spec can own a tenant shaped like this.
// Specs that start visits cannot share one: `Visit.routeItemId` is unique, so
// two of them racing over the same planned stop leaves the loser unable to
// start a visit at all. Defaults reproduce the original field-revisit tenant
// exactly, so calling this with no arguments is unchanged.
const TENANT_SLUG = process.argv[2] ?? "e2e-field-revisit";
const TENANT_NAME = process.argv[3] ?? "Vizitum E2E Field Revisit";
const LOCATION_NAME = process.argv[4] ?? "E2E Revisit Market";
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
const ANNOUNCEMENT_UNREAD_TITLE = "E2E notice still unread";
const ANNOUNCEMENT_READ_TITLE = "E2E notice already read";
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// The active window is inclusive of both ends against the tenant's today, so a
// day either side keeps the pair in force regardless of the timezone the API
// resolves for this tenant.
const announcementWindowStart = startOfUtcDay(
  new Date(Date.now() - MILLISECONDS_PER_DAY),
);
const announcementWindowEnd = startOfUtcDay(
  new Date(Date.now() + MILLISECONDS_PER_DAY),
);

const capabilities = [
  "team.basic_roles",
  "team.fixed_imports",
  "team.manager.full_tenant_view",
  "team.field_daily_flow",
  "ai.reporting",
];

try {
  const passwordHash = await hash(REP_PASSWORD);

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.platformTenant.upsert({
      where: { slug: TENANT_SLUG },
      create: {
        name: TENANT_NAME,
        slug: TENANT_SLUG,
        country: "UA",
        timezone: "Europe/Kiev",
        language: "en",
        status: "pilot",
        productMode: "team",
        segmentTemplate: "distribution",
        databasePlacement: "shared",
        databaseKey: "shared-primary",
      },
      update: {
        status: "pilot",
        language: "en",
        productMode: "team",
      },
    });

    await Promise.all(
      capabilities.map((capabilityCode) =>
        tx.productCapability.upsert({
          where: {
            tenantId_capabilityCode: { tenantId: tenant.id, capabilityCode },
          },
          create: { tenantId: tenant.id, capabilityCode, enabled: true },
          update: { enabled: true },
        }),
      ),
    );

    const representative = await tx.user.upsert({
      where: {
        tenantId_email: { tenantId: tenant.id, email: REP_EMAIL },
      },
      create: {
        tenantId: tenant.id,
        email: REP_EMAIL,
        name: "E2E Field Rep",
        passwordHash,
        status: "active",
        lastSelectedRoleCode: "field_representative",
      },
      update: {
        passwordHash,
        status: "active",
        lastSelectedRoleCode: "field_representative",
        deletedAt: null,
      },
    });

    await tx.userRole.upsert({
      where: {
        tenantId_userId_roleCode: {
          tenantId: tenant.id,
          userId: representative.id,
          roleCode: "field_representative",
        },
      },
      create: {
        tenantId: tenant.id,
        userId: representative.id,
        roleCode: "field_representative",
      },
      update: {},
    });

    const existingLocation = await tx.location.findFirst({
      where: { tenantId: tenant.id, externalCode: "e2e-revisit-location" },
    });
    const locationData = {
      name: LOCATION_NAME,
      status: "active",
      addressLine: "1 Revisit Street",
      city: "Kyiv",
    };
    const location = existingLocation
      ? await tx.location.update({
          where: { id: existingLocation.id },
          data: locationData,
        })
      : await tx.location.create({
          data: {
            tenantId: tenant.id,
            externalCode: "e2e-revisit-location",
            ...locationData,
          },
        });

    await tx.locationAssignment.upsert({
      where: {
        tenantId_locationId_representativeUserId: {
          tenantId: tenant.id,
          locationId: location.id,
          representativeUserId: representative.id,
        },
      },
      create: {
        tenantId: tenant.id,
        locationId: location.id,
        representativeUserId: representative.id,
        status: "active",
        assignedByUserId: representative.id,
      },
      update: { status: "active" },
    });

    // Reset leftovers from a previous run: the repeat visit the spec creates
    // stays in_progress (and would surface as "Continue visit" next time).
    await tx.visit.updateMany({
      where: {
        tenantId: tenant.id,
        representativeUserId: representative.id,
        status: { in: ["draft", "in_progress"] },
      },
      data: { status: "cancelled", cancelledAt: new Date() },
    });

    // No upsert here: (tenantId, representativeUserId, planDate) uniqueness
    // lives in partial SQL indexes Prisma can't see (see the RoutePlan model
    // comment in schema.prisma), so there is no compound key to upsert on.
    const planDate = startOfUtcDay(new Date());
    const existingPlan = await tx.routePlan.findFirst({
      where: {
        tenantId: tenant.id,
        representativeUserId: representative.id,
        planDate,
        routeTemplateId: null,
      },
    });
    const routePlan = existingPlan
      ? await tx.routePlan.update({
          where: { id: existingPlan.id },
          data: { status: "published", publishedAt: new Date() },
        })
      : await tx.routePlan.create({
          data: {
            tenantId: tenant.id,
            representativeUserId: representative.id,
            planDate,
            status: "published",
            createdByUserId: representative.id,
            publishedAt: new Date(),
          },
        });

    await tx.routeItem.upsert({
      where: {
        tenantId_routePlanId_sequence: {
          tenantId: tenant.id,
          routePlanId: routePlan.id,
          sequence: 1,
        },
      },
      create: {
        tenantId: tenant.id,
        routePlanId: routePlan.id,
        locationId: location.id,
        sequence: 1,
        status: "planned",
      },
      update: { locationId: location.id, status: "planned" },
    });

    // Two notices in force today, one of them already acknowledged — the pair
    // the announcements spec needs, since the split between them is the whole
    // behaviour: the home screen shows only the unread one, and the board
    // screen lists both. Seeded rather than published through the UI so the
    // spec itself mutates nothing and survives a retry.
    //
    // No natural key to upsert on, so they are matched by title and reused;
    // the receipt's own unique constraint carries the second half.
    for (const notice of [
      { title: ANNOUNCEMENT_UNREAD_TITLE, read: false },
      { title: ANNOUNCEMENT_READ_TITLE, read: true },
    ]) {
      const existing = await tx.announcement.findFirst({
        where: { tenantId: tenant.id, title: notice.title },
      });
      const announcement = existing
        ? await tx.announcement.update({
            where: { id: existing.id },
            data: {
              startsAt: announcementWindowStart,
              endsAt: announcementWindowEnd,
              archivedAt: null,
            },
          })
        : await tx.announcement.create({
            data: {
              tenantId: tenant.id,
              title: notice.title,
              body: `${notice.title} body.`,
              startsAt: announcementWindowStart,
              endsAt: announcementWindowEnd,
              createdByUserId: representative.id,
            },
          });

      if (notice.read) {
        await tx.announcementReadReceipt.upsert({
          where: {
            tenantId_announcementId_userId: {
              tenantId: tenant.id,
              announcementId: announcement.id,
              userId: representative.id,
            },
          },
          create: {
            tenantId: tenant.id,
            announcementId: announcement.id,
            userId: representative.id,
          },
          update: {},
        });
      } else {
        // A previous run's spec may have acknowledged it; the unread half has
        // to start unread or the next run asserts against the wrong state.
        await tx.announcementReadReceipt.deleteMany({
          where: { tenantId: tenant.id, announcementId: announcement.id },
        });
      }
    }
  });

  console.log(JSON.stringify({ status: "ok", tenantSlug: TENANT_SLUG }));
} finally {
  await prisma.$disconnect();
}

function required(value, name) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${name} is required.`);
  }

  return normalizedValue;
}

function assertLocalDatabaseUrl(connectionString) {
  let databaseUrl;

  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  if (
    (databaseUrl.protocol !== "postgresql:" &&
      databaseUrl.protocol !== "postgres:") ||
    !localHosts.has(databaseUrl.hostname.toLowerCase())
  ) {
    throw new Error(
      "seed-field-revisit is local-only. DATABASE_URL must point to localhost, 127.0.0.1 or ::1.",
    );
  }
}

function startOfUtcDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
