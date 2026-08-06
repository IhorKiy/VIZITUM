import { randomUUID } from "node:crypto";

import { buildUserNameFields } from "../../src/common/person-name";
import { PrismaService } from "../../src/modules/prisma/prisma.service";

/**
 * The harness for tests that need a real database.
 *
 * Until audit F8's volume test there were none: all 174 backend test files
 * instantiate services with stubs, and every fake `$transaction` is
 * `async (callback) => callback({…})` — it runs the callback and returns, so a
 * throw inside it propagates with nothing to undo. That left every
 * database-level guarantee the backend leans on unpinned, including one ticked
 * as a release gate (audit F24).
 *
 * Kept deliberately small. This is not a fixture framework: it resolves the
 * connection, hands back a `PrismaService`, and knows the delete order for a
 * tenant's rows — the one piece that is fiddly enough to be worth sharing,
 * since the schema does not cascade from `PlatformTenant` and getting it wrong
 * leaves rows behind that make the *next* run fail somewhere unrelated.
 *
 * `TEST_DATABASE_URL` names a scratch database. **Never point it at a database
 * whose contents matter** — these tests write and delete freely. CI provisions
 * one; locally:
 *
 *     docker exec vizitum-postgres psql -U postgres -c 'CREATE DATABASE vizitum_test;'
 *     DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vizitum_test" npx prisma migrate deploy
 *     TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vizitum_test" npm test
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * What to pass as a suite's `skip` option.
 *
 * A string rather than `true`, so a skipped run says *why* in the output — a
 * silently skipped database suite is indistinguishable from one that never
 * existed, which is the failure mode this whole area is about.
 */
export const skipWithoutDatabase = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL unset — see tests/fixtures/database.ts";

export function createTestPrisma(): PrismaService {
  if (!TEST_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL is required for database-backed tests.");
  }

  // PrismaService reads DATABASE_URL at construction; pointing it at the
  // scratch database here keeps the scratch/real distinction in one place.
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  return new PrismaService();
}

/** A tenant with a unique slug, so parallel or repeated runs never collide. */
export async function createTestTenant(
  prisma: PrismaService,
  namePrefix: string,
): Promise<{ tenantId: string; slug: string }> {
  const slug = `${namePrefix}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.platformTenant.create({
    data: {
      name: namePrefix,
      slug,
      country: "UA",
      timezone: "Europe/Kyiv",
      language: "uk",
      segmentTemplate: "distribution",
      databaseKey: namePrefix,
    },
    select: { id: true },
  });

  return { tenantId: tenant.id, slug };
}

export async function createTestUser(
  prisma: PrismaService,
  tenantId: string,
  email: string,
  roleCode?: "company_admin" | "team_manager" | "field_representative",
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      ...buildUserNameFields({ firstName: "Test", lastName: "User" }),
      status: "active",
    },
    select: { id: true },
  });

  if (roleCode) {
    await prisma.userRole.createMany({
      data: [{ tenantId, userId: user.id, roleCode }],
    });
  }

  return user.id;
}

/**
 * Removes everything a tenant owns, then the tenant.
 *
 * Ordered by dependency by hand because the schema does not cascade from
 * `PlatformTenant` — a tenant is soft-archived and then purged by a worker in
 * production, never deleted outright, so no cascade exists to lean on here.
 * Covers only the tables these suites write; a new database-backed test that
 * touches another one adds it rather than discovering the omission as a
 * foreign-key error in an unrelated run.
 */
export async function purgeTestTenant(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  await prisma.task.deleteMany({ where: { tenantId } });
  await prisma.routeItem.deleteMany({ where: { tenantId } });
  await prisma.routePlan.deleteMany({ where: { tenantId } });
  await prisma.locationContact.deleteMany({ where: { tenantId } });
  await prisma.locationAssignment.deleteMany({ where: { tenantId } });
  await prisma.location.deleteMany({ where: { tenantId } });
  await prisma.chain.deleteMany({ where: { tenantId } });
  await prisma.locationCategory.deleteMany({ where: { tenantId } });
  await prisma.product.deleteMany({ where: { tenantId } });
  await prisma.importRowIssue.deleteMany({ where: { tenantId } });
  await prisma.importJob.deleteMany({ where: { tenantId } });
  await prisma.userRole.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.platformTenant.delete({ where: { id: tenantId } });
}
