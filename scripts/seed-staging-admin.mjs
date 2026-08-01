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

const TEAM_MODE_CAPABILITIES = [
  "team.basic_roles",
  "team.fixed_imports",
  "team.manager.full_tenant_view",
  "team.field_daily_flow",
  "ai.reporting",
];

const tenantSlug = normalizeSlug(
  process.env.SEED_TENANT_SLUG || "vizitum-staging",
);
const tenantName = normalizeRequired(
  process.env.SEED_TENANT_NAME || "Vizitum Staging",
  "SEED_TENANT_NAME",
);
const adminEmail = normalizeEmail(
  normalizeRequired(process.env.SEED_ADMIN_EMAIL, "SEED_ADMIN_EMAIL"),
);
const adminFirstName = normalizeRequired(
  process.env.SEED_ADMIN_FIRST_NAME || "Vizitum",
  "SEED_ADMIN_FIRST_NAME",
);
const adminLastName = normalizeRequired(
  process.env.SEED_ADMIN_LAST_NAME || "Staging Admin",
  "SEED_ADMIN_LAST_NAME",
);
// `name` is derived, never seeded on its own — same rule the services follow.
const adminNameFields = {
  firstName: adminFirstName,
  lastName: adminLastName,
  name: `${adminFirstName} ${adminLastName}`,
};
const adminPassword = normalizeRequired(
  process.env.SEED_ADMIN_PASSWORD,
  "SEED_ADMIN_PASSWORD",
);
const adminRoleCodes = normalizeRoleCodes(
  process.env.SEED_ADMIN_ROLE_CODES ||
    "company_admin,team_manager,field_representative",
);
const seedSmokeData = parseBoolean(process.env.SEED_SMOKE_DATA ?? "true");
const confirmSmokeReport = parseBoolean(
  process.env.SEED_CONFIRM_SMOKE_REPORT ?? "false",
);

if (adminPassword.length < 8) {
  throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
}

try {
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.platformTenant.upsert({
      where: { slug: tenantSlug },
      create: {
        name: tenantName,
        slug: tenantSlug,
        country: "UA",
        timezone: "Europe/Kiev",
        language: "uk",
        // No `planCode`: migration 20260707175924_unify_tenant_status_and_plan
        // folded the plan tier into `status`, so the column is gone.
        status: "ready",
        productMode: "team",
        segmentTemplate: "distribution",
        databasePlacement: "shared",
        databaseKey: "shared-primary",
      },
      update: {
        name: tenantName,
        status: "ready",
      },
    });

    await tx.platformProvisioningJob.upsert({
      where: { id: `${tenant.id}:staging-seed` },
      create: {
        id: `${tenant.id}:staging-seed`,
        tenantId: tenant.id,
        status: "succeeded",
        step: "staging_seed",
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      update: {
        status: "succeeded",
        step: "staging_seed",
        finishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });

    await Promise.all(
      TEAM_MODE_CAPABILITIES.map((capabilityCode) =>
        tx.productCapability.upsert({
          where: {
            tenantId_capabilityCode: {
              tenantId: tenant.id,
              capabilityCode,
            },
          },
          create: {
            tenantId: tenant.id,
            capabilityCode,
            enabled: true,
          },
          update: { enabled: true },
        }),
      ),
    );

    const passwordHash = await hash(adminPassword);
    const user = await tx.user.upsert({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: adminEmail,
        },
      },
      create: {
        tenantId: tenant.id,
        email: adminEmail,
        ...adminNameFields,
        passwordHash,
        status: "active",
        lastSelectedRoleCode: adminRoleCodes[0],
      },
      update: {
        ...adminNameFields,
        passwordHash,
        status: "active",
        lastSelectedRoleCode: adminRoleCodes[0],
        deletedAt: null,
      },
    });

    for (const roleCode of adminRoleCodes) {
      await tx.userRole.upsert({
        where: {
          tenantId_userId_roleCode: {
            tenantId: tenant.id,
            userId: user.id,
            roleCode,
          },
        },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          roleCode,
        },
        update: {},
      });
    }

    const smokeData = seedSmokeData
      ? await seedSmokeVisitData(tx, tenant.id, user.id)
      : null;
    const smokeReport =
      smokeData && confirmSmokeReport
        ? await seedSmokeReport(tx, tenant, user.id, smokeData)
        : null;

    await tx.platformOperationEvent.create({
      data: {
        tenantId: tenant.id,
        actorUserId: user.id,
        eventType: "staging.seed_admin",
        metadata: {
          tenantSlug,
          adminEmail,
        },
      },
    });

    return { tenant, user, smokeData, smokeReport };
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tenantSlug: result.tenant.slug,
        tenantStatus: result.tenant.status,
        adminEmail: result.user.email,
        adminStatus: result.user.status,
        adminRoleCodes,
        smokeVisitId: result.smokeData?.visit.id,
        smokeReportId: result.smokeReport?.id,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}

function normalizeRequired(value, name) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`${name} is required.`);
  }

  return normalizedValue;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeSlug(value) {
  return value.trim().toLowerCase();
}

function normalizeRoleCodes(value) {
  const roleCodes = value
    .split(",")
    .map((roleCode) => roleCode.trim())
    .filter(Boolean);
  const allowedRoleCodes = new Set([
    "company_admin",
    "team_manager",
    "field_representative",
  ]);

  if (!roleCodes.length) {
    throw new Error("SEED_ADMIN_ROLE_CODES must include at least one role.");
  }

  for (const roleCode of roleCodes) {
    if (!allowedRoleCodes.has(roleCode)) {
      throw new Error(`Unsupported staging admin role: ${roleCode}.`);
    }
  }

  return roleCodes;
}

async function seedSmokeVisitData(tx, tenantId, userId) {
  const location = await tx.location.upsert({
    where: {
      tenantId_externalCode: {
        tenantId,
        externalCode: "smoke-location-1",
      },
    },
    create: {
      tenantId,
      externalCode: "smoke-location-1",
      name: "Smoke Test Location",
      type: "retail",
      status: "active",
      addressLine: "1 Test Street",
      city: "Kyiv",
      region: "Kyiv",
      territory: "Staging",
    },
    update: {
      name: "Smoke Test Location",
      status: "active",
      deletedAt: null,
    },
  });

  await tx.locationAssignment.upsert({
    where: {
      tenantId_locationId_representativeUserId: {
        tenantId,
        locationId: location.id,
        representativeUserId: userId,
      },
    },
    create: {
      tenantId,
      locationId: location.id,
      representativeUserId: userId,
      status: "active",
      assignedByUserId: userId,
    },
    update: {
      status: "active",
      assignedByUserId: userId,
    },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const routePlan = await tx.routePlan.upsert({
    where: {
      tenantId_representativeUserId_planDate: {
        tenantId,
        representativeUserId: userId,
        planDate: today,
      },
    },
    create: {
      tenantId,
      representativeUserId: userId,
      planDate: today,
      status: "published",
      createdByUserId: userId,
      publishedAt: new Date(),
    },
    update: {
      status: "published",
      publishedAt: new Date(),
    },
  });

  const routeItem = await tx.routeItem.upsert({
    where: {
      tenantId_routePlanId_sequence: {
        tenantId,
        routePlanId: routePlan.id,
        sequence: 1,
      },
    },
    create: {
      tenantId,
      routePlanId: routePlan.id,
      locationId: location.id,
      sequence: 1,
      status: "planned",
    },
    update: {
      locationId: location.id,
      status: "planned",
    },
  });

  const visit = await tx.visit.upsert({
    where: { routeItemId: routeItem.id },
    create: {
      tenantId,
      locationId: location.id,
      representativeUserId: userId,
      routeItemId: routeItem.id,
      visitType: "smoke_test",
      status: "in_progress",
      startedAt: new Date(),
    },
    update: {
      locationId: location.id,
      representativeUserId: userId,
      status: "in_progress",
      completedAt: null,
      cancelledAt: null,
    },
  });

  return { location, routePlan, routeItem, visit };
}

async function seedSmokeReport(tx, tenant, userId, smokeData) {
  const confirmedAt = new Date();

  await tx.visitNote.create({
    data: {
      tenantId: tenant.id,
      visitId: smokeData.visit.id,
      inputType: "text",
      textContent: "Smoke test manual report note.",
      createdByUserId: userId,
    },
  });

  const report = await tx.report.upsert({
    where: { visitId: smokeData.visit.id },
    create: {
      tenantId: tenant.id,
      visitId: smokeData.visit.id,
      locationId: smokeData.location.id,
      representativeUserId: userId,
      templateCode: tenant.segmentTemplate,
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData: {
        smokeTest: true,
        summary: "Manual report confirmation smoke test.",
      },
      confirmedByUserId: userId,
      confirmedAt,
      aiMetadata: {
        source: "manual_text",
        smokeTest: true,
      },
    },
    update: {
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData: {
        smokeTest: true,
        summary: "Manual report confirmation smoke test.",
      },
      confirmedByUserId: userId,
      confirmedAt,
      aiMetadata: {
        source: "manual_text",
        smokeTest: true,
      },
    },
  });

  await tx.visit.update({
    where: { id: smokeData.visit.id },
    data: {
      status: "completed",
      completedAt: confirmedAt,
    },
  });

  await tx.routeItem.update({
    where: { id: smokeData.routeItem.id },
    data: { status: "visited" },
  });

  return report;
}

function parseBoolean(value) {
  const normalizedValue = value.trim().toLowerCase();

  if (["1", "true", "yes"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no"].includes(normalizedValue)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}.`);
}
