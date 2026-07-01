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
const adminName = normalizeRequired(
  process.env.SEED_ADMIN_NAME || "Vizitum Staging Admin",
  "SEED_ADMIN_NAME",
);
const adminPassword = normalizeRequired(
  process.env.SEED_ADMIN_PASSWORD,
  "SEED_ADMIN_PASSWORD",
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
        status: "ready",
        planCode: "pilot",
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
        name: adminName,
        passwordHash,
        status: "active",
        lastSelectedRoleCode: "company_admin",
      },
      update: {
        name: adminName,
        passwordHash,
        status: "active",
        lastSelectedRoleCode: "company_admin",
        deletedAt: null,
      },
    });

    await tx.userRole.upsert({
      where: {
        tenantId_userId_roleCode: {
          tenantId: tenant.id,
          userId: user.id,
          roleCode: "company_admin",
        },
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        roleCode: "company_admin",
      },
      update: {},
    });

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

    return { tenant, user };
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tenantSlug: result.tenant.slug,
        tenantStatus: result.tenant.status,
        adminEmail: result.user.email,
        adminStatus: result.user.status,
        adminRole: "company_admin",
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
