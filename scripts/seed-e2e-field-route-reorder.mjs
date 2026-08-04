import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

// Seed for the field-route-reorder e2e spec: a dedicated tenant with one
// field representative, three locations and a route template holding them
// as stops 1/2/3 — three, not two, so a second consecutive keyboard move
// actually has somewhere new to land instead of coincidentally recomputing
// the same result either way (see field-route-reorder.spec.ts's own header
// comment for why). Re-running restores the original 1/2/3 order, so the
// spec always starts from the same state against the shared local database.
//
// Also seeds a second, independent route template (own stops, own name) for
// the rapid-consecutive-moves regression test: playwright.config.ts runs
// with fullyParallel: true, so that test can execute concurrently with this
// one in a different worker, and two tests reordering the same template's
// stops at once would race each other at the test level regardless of
// whether the app itself has a request race.
//
// The tenant language is "en" on purpose — the spec matches UI strings from
// apps/web/messages/en.json.

const connectionString = required(process.env.DATABASE_URL, "DATABASE_URL");
assertLocalDatabaseUrl(connectionString);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const TENANT_SLUG = "e2e-field-route-reorder";
const TENANT_NAME = "Vizitum E2E Route Reorder";
const REP_EMAIL = `rep@${TENANT_SLUG}.local`;
const REP_PASSWORD = "E2eField12345!";
const ROUTE_TEMPLATE_NAME = "E2E Reorder Route";
const STOP_A_NAME = "E2E Reorder Stop A";
const STOP_B_NAME = "E2E Reorder Stop B";
const STOP_C_NAME = "E2E Reorder Stop C";
// Not "E2E Reorder Route Rapid": see the matching comment in
// field-route-reorder.spec.ts on why that collides with ROUTE_TEMPLATE_NAME.
const RAPID_ROUTE_TEMPLATE_NAME = "E2E Rapid Reorder Route";
const RAPID_STOP_A_NAME = "E2E Reorder Rapid Stop A";
const RAPID_STOP_B_NAME = "E2E Reorder Rapid Stop B";
const RAPID_STOP_C_NAME = "E2E Reorder Rapid Stop C";

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
        firstName: "E2E",
        lastName: "Route Reorder Rep",
        name: "E2E Route Reorder Rep",
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

    // routeTemplateItem's only location check (createRouteTemplateItem /
    // RouteTemplatesService) is tenant ownership, not assignment — so these
    // don't need a LocationAssignment row to be usable as template stops.
    const stopA = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-stop-a",
      name: STOP_A_NAME,
    });
    const stopB = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-stop-b",
      name: STOP_B_NAME,
    });
    const stopC = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-stop-c",
      name: STOP_C_NAME,
    });

    // No natural key beyond (tenantId, representativeUserId) + name to find
    // an existing template by — RouteTemplate carries no other unique
    // constraint (see schema.prisma) — so it's matched the same way the
    // announcements in seed-e2e-field-revisit.mjs are: by name, then reused.
    const existingTemplate = await tx.routeTemplate.findFirst({
      where: {
        tenantId: tenant.id,
        representativeUserId: representative.id,
        name: ROUTE_TEMPLATE_NAME,
      },
    });
    const routeTemplate =
      existingTemplate ??
      (await tx.routeTemplate.create({
        data: {
          tenantId: tenant.id,
          representativeUserId: representative.id,
          name: ROUTE_TEMPLATE_NAME,
        },
      }));

    // Sequence is part of the unique key items are upserted on
    // (tenantId, routeTemplateId, sequence) — restores stops A/B/C to
    // 1/2/3 regardless of what a previous run's reorder left behind.
    const stopsBySequence = [stopA, stopB, stopC];

    for (const [index, stop] of stopsBySequence.entries()) {
      const sequence = index + 1;

      await tx.routeTemplateItem.upsert({
        where: {
          tenantId_routeTemplateId_sequence: {
            tenantId: tenant.id,
            routeTemplateId: routeTemplate.id,
            sequence,
          },
        },
        create: {
          tenantId: tenant.id,
          routeTemplateId: routeTemplate.id,
          locationId: stop.id,
          sequence,
        },
        update: { locationId: stop.id },
      });
    }

    const rapidStopA = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-rapid-stop-a",
      name: RAPID_STOP_A_NAME,
    });
    const rapidStopB = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-rapid-stop-b",
      name: RAPID_STOP_B_NAME,
    });
    const rapidStopC = await upsertLocation(tx, tenant.id, {
      externalCode: "e2e-route-reorder-rapid-stop-c",
      name: RAPID_STOP_C_NAME,
    });

    const existingRapidTemplate = await tx.routeTemplate.findFirst({
      where: {
        tenantId: tenant.id,
        representativeUserId: representative.id,
        name: RAPID_ROUTE_TEMPLATE_NAME,
      },
    });
    const rapidRouteTemplate =
      existingRapidTemplate ??
      (await tx.routeTemplate.create({
        data: {
          tenantId: tenant.id,
          representativeUserId: representative.id,
          name: RAPID_ROUTE_TEMPLATE_NAME,
        },
      }));
    const rapidStopsBySequence = [rapidStopA, rapidStopB, rapidStopC];

    for (const [index, stop] of rapidStopsBySequence.entries()) {
      const sequence = index + 1;

      await tx.routeTemplateItem.upsert({
        where: {
          tenantId_routeTemplateId_sequence: {
            tenantId: tenant.id,
            routeTemplateId: rapidRouteTemplate.id,
            sequence,
          },
        },
        create: {
          tenantId: tenant.id,
          routeTemplateId: rapidRouteTemplate.id,
          locationId: stop.id,
          sequence,
        },
        update: { locationId: stop.id },
      });
    }

    console.log(
      JSON.stringify({
        status: "ok",
        tenantSlug: TENANT_SLUG,
        routeTemplateId: routeTemplate.id,
        rapidRouteTemplateId: rapidRouteTemplate.id,
      }),
    );
  });
} finally {
  await prisma.$disconnect();
}

async function upsertLocation(tx, tenantId, { externalCode, name }) {
  const existing = await tx.location.findFirst({
    where: { tenantId, externalCode },
  });
  const data = {
    name,
    status: "active",
    addressLine: "1 Reorder Street",
    city: "Kyiv",
  };

  return existing
    ? tx.location.update({ where: { id: existing.id }, data })
    : tx.location.create({
        data: { tenantId, externalCode, ...data },
      });
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
      "seed-e2e-field-route-reorder is local-only. DATABASE_URL must point to localhost, 127.0.0.1 or ::1.",
    );
  }
}
