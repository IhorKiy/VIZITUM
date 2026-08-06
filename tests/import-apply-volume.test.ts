import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildUserNameFields } from "../src/common/person-name";
import { ImportsService } from "../src/modules/imports/imports.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";

// The one test in this repository that talks to a database, and it exists
// because audit F8 could not have been caught without one: every other backend
// test instantiates services against stubs whose fake `$transaction` just
// invokes its callback, so no transaction in the suite has a budget that could
// expire (audit F24 records the same absence as its own finding). A per-row
// query loop inside a 5 000 ms transaction is invisible to all of them.
//
// It is opt-in rather than skipped-by-default-forever: CI's backend job has no
// Postgres service, so a test that assumed one would fail the build. Run it
// against a scratch database — never a database with data you want:
//
//   docker exec vizitum-postgres psql -U postgres -c 'CREATE DATABASE vizitum_f8;'
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vizitum_f8" npx prisma migrate deploy
//   IMPORT_VOLUME_TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/vizitum_f8" \
//     node --import tsx --test tests/import-apply-volume.test.ts
//
// Two things are asserted that only a real database can show: that a
// several-hundred-row file applies at all inside the transaction budget, and
// that each location keeps the representative its own row named — the apply
// correlates `createManyAndReturn`'s result to its source rows by position, and
// getting that wrong would attach reps to the wrong outlets without erroring.

const VOLUME_DATABASE_URL = process.env.IMPORT_VOLUME_TEST_DATABASE_URL;
const ROW_COUNT = 500;
const REPRESENTATIVE_COUNT = 5;

describe(
  "import apply: a several-hundred-row file applies against a real database",
  { skip: VOLUME_DATABASE_URL ? false : "IMPORT_VOLUME_TEST_DATABASE_URL unset" },
  () => {
    let prisma: PrismaService;
    let tenantId: string;
    let adminUserId: string;
    const representativeEmails = Array.from(
      { length: REPRESENTATIVE_COUNT },
      (_, index) => `volume-rep-${index}@example.com`,
    );

    before(async () => {
      process.env.DATABASE_URL = VOLUME_DATABASE_URL;
      prisma = new PrismaService();
      await prisma.$connect();

      const tenant = await prisma.platformTenant.create({
        data: {
          name: "Import volume",
          slug: `import-volume-${Date.now()}`,
          country: "UA",
          timezone: "Europe/Kyiv",
          language: "uk",
          segmentTemplate: "distribution",
          databaseKey: "import-volume",
        },
        select: { id: true },
      });

      tenantId = tenant.id;

      const admin = await prisma.user.create({
        data: {
          tenantId,
          email: "volume-admin@example.com",
          ...buildUserNameFields({ firstName: "Volume", lastName: "Admin" }),
          status: "active",
        },
        select: { id: true },
      });

      adminUserId = admin.id;

      await prisma.user.createMany({
        data: representativeEmails.map((email, index) => ({
          tenantId,
          email,
          ...buildUserNameFields({ firstName: "Rep", lastName: `${index}` }),
          status: "active" as const,
        })),
      });

      const representatives = await prisma.user.findMany({
        where: { tenantId, email: { in: representativeEmails } },
        select: { id: true },
      });

      await prisma.userRole.createMany({
        data: representatives.map((representative) => ({
          tenantId,
          userId: representative.id,
          roleCode: "field_representative" as const,
        })),
      });
    });

    after(async () => {
      if (tenantId) {
        // Ordered by dependency: the schema does not cascade from the tenant.
        await prisma.locationAssignment.deleteMany({ where: { tenantId } });
        await prisma.location.deleteMany({ where: { tenantId } });
        await prisma.chain.deleteMany({ where: { tenantId } });
        await prisma.locationCategory.deleteMany({ where: { tenantId } });
        await prisma.importRowIssue.deleteMany({ where: { tenantId } });
        await prisma.importJob.deleteMany({ where: { tenantId } });
        await prisma.userRole.deleteMany({ where: { tenantId } });
        await prisma.user.deleteMany({ where: { tenantId } });
        await prisma.platformTenant.delete({ where: { id: tenantId } });
      }

      await prisma.$disconnect();
    });

    it(`validates and applies a ${ROW_COUNT}-row locations file`, async () => {
      const service = new ImportsService(prisma);
      const context = {
        requestId: "request-volume",
        tenantId,
        tenantSlug: "import-volume",
        userId: adminUserId,
        roleCodes: ["company_admin"],
        permissions: [],
      };
      const parsed = service.parseApprovedCsvTemplate(
        "locations",
        buildLocationsCsv(),
      );

      assert.equal(parsed.rows.length, ROW_COUNT);

      const preview = await service.createImportValidationJob(
        context as never,
        parsed,
      );

      assert.equal(preview.canConfirm, true);
      assert.equal(preview.rowCount, ROW_COUNT);

      const startedAt = Date.now();
      const applied = await service.confirmImportJob(
        context as never,
        preview.importJobId,
      );
      const elapsedMs = Date.now() - startedAt;

      assert.equal(applied.status, "applied");
      assert.equal(applied.createdCounts.locations, ROW_COUNT);
      assert.equal(applied.createdCounts.locationAssignments, ROW_COUNT);
      // Three chains and four categories across 500 rows, each created once.
      assert.equal(applied.createdCounts.chains, 3);
      assert.equal(applied.createdCounts.locationCategories, 4);

      // The number that F8 is about. Prisma's default interactive-transaction
      // budget is 5 000 ms, and the per-row version needed ~2 500 round trips
      // for this file. Asserted generously — this is a cliff check, not a
      // benchmark, and it must not turn into a flaky timing test on a busy
      // machine.
      assert.ok(
        elapsedMs < 5_000,
        `apply took ${elapsedMs}ms, which would not fit Prisma's default transaction budget`,
      );

      // Every outlet kept the representative its own CSV row named.
      const assignments = await prisma.locationAssignment.findMany({
        where: { tenantId },
        select: {
          location: { select: { externalCode: true } },
          representative: { select: { email: true } },
        },
      });

      assert.equal(assignments.length, ROW_COUNT);

      for (const assignment of assignments) {
        const rowIndex = Number(
          assignment.location.externalCode?.replace("VOL-", ""),
        );

        assert.equal(
          assignment.representative.email,
          representativeEmails[rowIndex % REPRESENTATIVE_COUNT],
        );
      }
    });

    function buildLocationsCsv(): string {
      const chains = ["Chain A", "Chain B", "Chain C"];
      const categories = ["Grocery", "Kiosk", "Pharmacy", "Warehouse"];
      const header =
        "name,address_line,city,chain,category,external_code,assigned_representative_email";
      const rows = Array.from({ length: ROW_COUNT }, (_, index) =>
        [
          `Store ${index}`,
          `Address line ${index}`,
          "Kyiv",
          chains[index % chains.length],
          categories[index % categories.length],
          `VOL-${index}`,
          representativeEmails[index % REPRESENTATIVE_COUNT],
        ].join(","),
      );

      return [header, ...rows, ""].join("\n");
    }
  },
);
