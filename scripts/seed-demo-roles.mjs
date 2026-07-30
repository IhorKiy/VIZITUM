import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const connectionString = required(process.env.DATABASE_URL, "DATABASE_URL");
assertLocalDatabaseUrl(connectionString);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const tenantSlug = normalizeSlug(process.env.DEMO_TENANT_SLUG || "demo-team");
const tenantName = required(
  process.env.DEMO_TENANT_NAME || "Vizitum Demo Team",
  "DEMO_TENANT_NAME",
);
const password = process.env.DEMO_ROLE_PASSWORD || "Demo12345!";

if (password.length < 8) {
  throw new Error("DEMO_ROLE_PASSWORD must be at least 8 characters.");
}

const capabilities = [
  "team.basic_roles",
  "team.fixed_imports",
  "team.manager.full_tenant_view",
  "team.field_daily_flow",
  "ai.reporting",
];

const users = [
  {
    email: "superadmin@demo-team.local",
    firstName: "Demo",
    lastName: "Tenant Superadmin",
    roles: ["tenant_superadmin"],
  },
  {
    email: "admin@demo-team.local",
    firstName: "Demo",
    lastName: "Company Admin",
    roles: ["company_admin"],
  },
  {
    email: "manager@demo-team.local",
    firstName: "Demo",
    lastName: "Team Manager",
    roles: ["team_manager"],
  },
  {
    email: "field@demo-team.local",
    firstName: "Demo",
    lastName: "Field Representative",
    roles: ["field_representative"],
  },
  {
    email: "allroles@demo-team.local",
    firstName: "Demo",
    lastName: "All Roles",
    roles: ["company_admin", "team_manager", "field_representative"],
  },
];

try {
  const passwordHash = await hash(password);
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await upsertTenant(tx);

    await Promise.all(
      capabilities.map((capabilityCode) =>
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

    await tx.tenantSetting.upsert({
      where: {
        tenantId_key: {
          tenantId: tenant.id,
          key: "products.enabled",
        },
      },
      create: {
        tenantId: tenant.id,
        key: "products.enabled",
        value: true,
      },
      update: { value: true },
    });

    const seededUsers = {};
    for (const user of users) {
      seededUsers[user.email] = await upsertUser(tx, {
        tenantId: tenant.id,
        passwordHash,
        ...user,
      });
    }

    const locations = await seedLocations(tx, tenant.id);
    await seedProducts(tx, tenant.id);

    await seedRepresentativeWorkspace(tx, {
      tenant,
      representative: seededUsers["field@demo-team.local"],
      manager: seededUsers["manager@demo-team.local"],
      locations,
      sequenceOffset: 0,
    });

    await seedRepresentativeWorkspace(tx, {
      tenant,
      representative: seededUsers["allroles@demo-team.local"],
      manager: seededUsers["manager@demo-team.local"],
      locations,
      sequenceOffset: 10,
    });

    await tx.platformOperationEvent.create({
      data: {
        tenantId: tenant.id,
        actorUserId: seededUsers["admin@demo-team.local"].id,
        eventType: "local.seed_demo_roles",
        metadata: {
          tenantSlug,
          emails: users.map((user) => user.email),
        },
      },
    });

    return {
      tenant,
      users: Object.values(seededUsers).map((user) => ({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
      })),
    };
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        tenantSlug: result.tenant.slug,
        loginUrl: `http://localhost:3000/${result.tenant.slug}/login`,
        password,
        users: users.map((user) => ({
          email: user.email,
          roles: user.roles,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}

async function upsertTenant(tx) {
  const tenant = await tx.platformTenant.upsert({
    where: { slug: tenantSlug },
    create: {
      name: tenantName,
      slug: tenantSlug,
      country: "UA",
      timezone: "Europe/Kiev",
      language: "uk",
      status: "pilot",
      productMode: "team",
      segmentTemplate: "distribution",
      databasePlacement: "shared",
      databaseKey: "shared-primary",
    },
    update: {
      name: tenantName,
      status: "pilot",
      timezone: "Europe/Kiev",
      language: "uk",
      productMode: "team",
      segmentTemplate: "distribution",
    },
  });

  await tx.platformProvisioningJob.upsert({
    where: { id: `${tenant.id}:demo-role-seed` },
    create: {
      id: `${tenant.id}:demo-role-seed`,
      tenantId: tenant.id,
      status: "succeeded",
      step: "demo_role_seed",
      startedAt: new Date(),
      finishedAt: new Date(),
    },
    update: {
      status: "succeeded",
      step: "demo_role_seed",
      finishedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });

  return tenant;
}

async function upsertUser(
  tx,
  { tenantId, email, firstName, lastName, roles, passwordHash },
) {
  const normalizedEmail = normalizeEmail(email);
  // `name` is derived, never seeded on its own — same rule the services follow.
  const nameFields = {
    firstName,
    lastName,
    name: lastName ? `${firstName} ${lastName}` : firstName,
  };
  const user = await tx.user.upsert({
    where: {
      tenantId_email: {
        tenantId,
        email: normalizedEmail,
      },
    },
    create: {
      tenantId,
      email: normalizedEmail,
      ...nameFields,
      passwordHash,
      status: "active",
      lastSelectedRoleCode: roles[0],
    },
    update: {
      ...nameFields,
      passwordHash,
      status: "active",
      lastSelectedRoleCode: roles[0],
      deletedAt: null,
    },
  });

  for (const roleCode of roles) {
    await tx.userRole.upsert({
      where: {
        tenantId_userId_roleCode: {
          tenantId,
          userId: user.id,
          roleCode,
        },
      },
      create: {
        tenantId,
        userId: user.id,
        roleCode,
      },
      update: {},
    });
  }

  return user;
}

async function seedLocations(tx, tenantId) {
  const rows = [
    {
      externalCode: "demo-location-central",
      name: "Central Kyiv Market",
      status: "active",
      addressLine: "12 Khreshchatyk Street",
      city: "Kyiv",
      region: "Kyiv",
      territory: "Center",
      notes: "High-priority demo account with regular coverage.",
    },
    {
      externalCode: "demo-location-left-bank",
      name: "Left Bank Partner",
      status: "active",
      addressLine: "8 Sobornosti Avenue",
      city: "Kyiv",
      region: "Kyiv",
      territory: "Left Bank",
      notes: "Use for partner-account visit testing.",
    },
    {
      externalCode: "demo-location-service",
      name: "Service Point Podil",
      status: "inactive",
      addressLine: "4 Kontraktova Square",
      city: "Kyiv",
      region: "Kyiv",
      territory: "Podil",
      notes: "Inactive row for admin and manager filters.",
    },
  ];

  const locations = [];
  for (const row of rows) {
    // Location's (tenantId, externalCode) uniqueness is a PARTIAL index scoped to
    // `deletedAt IS NULL`, which Prisma can't target with `upsert`. Match only a
    // LIVE row: a soft-deleted row must not be revived here, since a live row
    // with the same code may coexist and reviving the deleted one would violate
    // the partial index. If none is live, create a fresh row.
    const existing = await tx.location.findFirst({
      where: { tenantId, externalCode: row.externalCode, deletedAt: null },
    });

    if (existing) {
      locations.push(
        await tx.location.update({
          where: { id: existing.id },
          data: {
            ...row,
          },
        }),
      );
    } else {
      locations.push(
        await tx.location.create({
          data: {
            tenantId,
            ...row,
          },
        }),
      );
    }
  }

  return locations;
}

async function seedProducts(tx, tenantId) {
  const rows = [
    {
      externalCode: "demo-product-premium",
      name: "Premium Display Kit",
      sku: "VDK-001",
      category: "Merchandising",
      status: "active",
      notApplicable: false,
    },
    {
      externalCode: "demo-product-service",
      name: "Service Visit Pack",
      sku: "SVP-010",
      category: "Service",
      status: "active",
      notApplicable: false,
    },
    {
      externalCode: "demo-product-legacy",
      name: "Legacy Promo Bundle",
      sku: "LPB-099",
      category: "Promo",
      status: "archived",
      notApplicable: true,
    },
  ];

  for (const row of rows) {
    // Product's (tenantId, externalCode) uniqueness is a PARTIAL index scoped to
    // `deletedAt IS NULL`, which Prisma can't target with `upsert`. Match only a
    // LIVE row: a soft-deleted row must not be revived here, since a live row
    // with the same code may coexist and reviving the deleted one would violate
    // the partial index. If none is live, create a fresh row.
    const existing = await tx.product.findFirst({
      where: { tenantId, externalCode: row.externalCode, deletedAt: null },
    });

    if (existing) {
      await tx.product.update({
        where: { id: existing.id },
        data: {
          ...row,
        },
      });
    } else {
      await tx.product.create({
        data: {
          tenantId,
          ...row,
        },
      });
    }
  }
}

async function seedRepresentativeWorkspace(
  tx,
  { tenant, representative, manager, locations, sequenceOffset },
) {
  for (const location of locations.slice(0, 2)) {
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
        assignedByUserId: manager.id,
      },
      update: {
        status: "active",
        assignedByUserId: manager.id,
      },
    });
  }

  const today = startOfUtcDay(new Date());
  const yesterday = addDays(today, -1);

  const todayRoute = await upsertRoutePlan(tx, {
    tenantId: tenant.id,
    representativeUserId: representative.id,
    planDate: today,
    createdByUserId: manager.id,
  });

  const openRouteItem = await upsertRouteItem(tx, {
    tenantId: tenant.id,
    routePlanId: todayRoute.id,
    locationId: locations[0].id,
    sequence: sequenceOffset + 1,
    status: "planned",
  });

  await tx.visit.upsert({
    where: { routeItemId: openRouteItem.id },
    create: {
      tenantId: tenant.id,
      locationId: locations[0].id,
      representativeUserId: representative.id,
      routeItemId: openRouteItem.id,
      visitType: "distribution",
      status: "in_progress",
      startedAt: new Date(),
    },
    update: {
      locationId: locations[0].id,
      representativeUserId: representative.id,
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      cancelledAt: null,
    },
  });

  const yesterdayRoute = await upsertRoutePlan(tx, {
    tenantId: tenant.id,
    representativeUserId: representative.id,
    planDate: yesterday,
    createdByUserId: manager.id,
  });

  const completedRouteItem = await upsertRouteItem(tx, {
    tenantId: tenant.id,
    routePlanId: yesterdayRoute.id,
    locationId: locations[1].id,
    sequence: sequenceOffset + 1,
    status: "visited",
  });

  const completedAt = addHours(yesterday, 11);
  const completedVisit = await tx.visit.upsert({
    where: { routeItemId: completedRouteItem.id },
    create: {
      tenantId: tenant.id,
      locationId: locations[1].id,
      representativeUserId: representative.id,
      routeItemId: completedRouteItem.id,
      visitType: "distribution",
      status: "completed",
      startedAt: addHours(yesterday, 10),
      completedAt,
    },
    update: {
      locationId: locations[1].id,
      representativeUserId: representative.id,
      status: "completed",
      startedAt: addHours(yesterday, 10),
      completedAt,
      cancelledAt: null,
    },
  });

  const seededNote = await tx.visitNote.findFirst({
    where: {
      tenantId: tenant.id,
      visitId: completedVisit.id,
      createdByUserId: representative.id,
      inputType: "text",
      textContent: "Demo role seed: shelf check completed, follow-up needed.",
      deletedAt: null,
    },
  });

  if (!seededNote) {
    await tx.visitNote.create({
      data: {
        tenantId: tenant.id,
        visitId: completedVisit.id,
        inputType: "text",
        textContent: "Demo role seed: shelf check completed, follow-up needed.",
        createdByUserId: representative.id,
      },
    });
  }

  const report = await tx.report.upsert({
    where: { visitId: completedVisit.id },
    create: {
      tenantId: tenant.id,
      visitId: completedVisit.id,
      locationId: locations[1].id,
      representativeUserId: representative.id,
      templateCode: tenant.segmentTemplate,
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData: {
        summary: "Demo confirmed report for role-screen testing.",
        resultStatus: "follow_up_needed",
        nextSteps: ["Check display materials", "Confirm next delivery window"],
      },
      confirmedByUserId: representative.id,
      confirmedAt: completedAt,
      aiMetadata: {
        source: "manual_text",
        demoRoleSeed: true,
      },
    },
    update: {
      locationId: locations[1].id,
      representativeUserId: representative.id,
      schemaVersion: "manual.v1",
      status: "confirmed",
      confirmedData: {
        summary: "Demo confirmed report for role-screen testing.",
        resultStatus: "follow_up_needed",
        nextSteps: ["Check display materials", "Confirm next delivery window"],
      },
      confirmedByUserId: representative.id,
      confirmedAt: completedAt,
      aiMetadata: {
        source: "manual_text",
        demoRoleSeed: true,
      },
    },
  });

  await tx.task.upsert({
    where: { id: `${tenant.id}:${representative.id}:demo-open-task` },
    create: {
      id: `${tenant.id}:${representative.id}:demo-open-task`,
      tenantId: tenant.id,
      title: "Demo follow-up: confirm display materials",
      description: "Seeded task for field and manager task screens.",
      status: "in_progress",
      isPriority: true,
      assignedToUserId: representative.id,
      createdByUserId: manager.id,
      locationId: locations[1].id,
      visitId: completedVisit.id,
      reportId: report.id,
      dueDate: addDays(today, 2),
    },
    update: {
      title: "Demo follow-up: confirm display materials",
      description: "Seeded task for field and manager task screens.",
      status: "in_progress",
      isPriority: true,
      assignedToUserId: representative.id,
      createdByUserId: manager.id,
      locationId: locations[1].id,
      visitId: completedVisit.id,
      reportId: report.id,
      dueDate: addDays(today, 2),
      completedAt: null,
      deletedAt: null,
    },
  });
}

async function upsertRoutePlan(
  tx,
  { tenantId, representativeUserId, planDate, createdByUserId },
) {
  // Uniqueness of (tenantId, representativeUserId, planDate) for
  // template-less plans is enforced by a partial SQL index Prisma can't see
  // (see the RoutePlan model comment in prisma/schema.prisma), so no upsert —
  // find the manual plan for the day, then update or create.
  const existingPlan = await tx.routePlan.findFirst({
    where: {
      tenantId,
      representativeUserId,
      planDate,
      routeTemplateId: null,
    },
  });

  if (existingPlan) {
    return tx.routePlan.update({
      where: { id: existingPlan.id },
      data: {
        status: "published",
        createdByUserId,
        publishedAt: new Date(),
      },
    });
  }

  return tx.routePlan.create({
    data: {
      tenantId,
      representativeUserId,
      planDate,
      status: "published",
      createdByUserId,
      publishedAt: new Date(),
    },
  });
}

async function upsertRouteItem(
  tx,
  { tenantId, routePlanId, locationId, sequence, status },
) {
  return tx.routeItem.upsert({
    where: {
      tenantId_routePlanId_sequence: {
        tenantId,
        routePlanId,
        sequence,
      },
    },
    create: {
      tenantId,
      routePlanId,
      locationId,
      sequence,
      status,
    },
    update: {
      locationId,
      status,
    },
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
      "seed:demo-roles is local-only. DATABASE_URL must point to localhost, 127.0.0.1 or ::1.",
    );
  }
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function normalizeSlug(value) {
  return value.trim().toLowerCase();
}

function startOfUtcDay(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addHours(value, hours) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date;
}
