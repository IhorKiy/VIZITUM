import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildUserNameFields } from "../src/common/person-name";
import { ImportsService } from "../src/modules/imports/imports.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  createTestPrisma,
  createTestTenant,
  purgeTestTenant,
  skipWithoutDatabase,
} from "./fixtures/database";

// The one test in this repository that talks to a database, and it exists
// because audit F8 could not have been caught without one: every other backend
// test instantiates services against stubs whose fake `$transaction` just
// invokes its callback, so no transaction in the suite has a budget that could
// expire (audit F24 records the same absence as its own finding). A per-row
// query loop inside a 5 000 ms transaction is invisible to all of them.
//
// It now runs in CI: the backend job provisions a Postgres service and sets
// `TEST_DATABASE_URL`, which is what closed audit F24. It still skips — loudly,
// with a reason — when that variable is absent, so a checkout with no database
// is not a broken build. `tests/fixtures/database.ts` has the local setup.
//
// Two things are asserted that only a real database can show: that a
// several-hundred-row file applies at all inside the transaction budget, and
// that each location keeps the representative its own row named. The second is
// the one a fake cannot stand in for — it needs the ids the apply minted to be
// the ids the database actually stored, which is what makes the client-side
// `createCuid` correlation real rather than merely internally consistent. Its
// predecessor read ids back out of `createManyAndReturn` and paired them with
// their source rows by position; this assertion is what would have caught that
// going wrong, since every row would still be present and nothing would error.

// The largest file an import accepts (`MAX_IMPORT_ROWS`), so this exercises the
// ceiling rather than a comfortable middle.
const ROW_COUNT = 1000;
const REPRESENTATIVE_COUNT = 5;

describe(
  "import apply: a several-hundred-row file applies against a real database",
  { skip: skipWithoutDatabase },
  () => {
    let prisma: PrismaService;
    let tenantId: string;
    let adminUserId: string;
    const representativeEmails = Array.from(
      { length: REPRESENTATIVE_COUNT },
      (_, index) => `volume-rep-${index}@example.com`,
    );

    before(async () => {
      prisma = createTestPrisma();
      await prisma.$connect();

      tenantId = (await createTestTenant(prisma, "import-volume")).tenantId;

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
        await purgeTestTenant(prisma, tenantId);
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

      // Asserted against Prisma's *default* 5 000 ms budget rather than the
      // raised one this apply actually runs under, because that default is the
      // number F8 is about — a full-size file has to fit it with room to spare,
      // not merely fit the headroom that was added around it.
      //
      // Read this as a cliff check, not a benchmark, and **do not mistake it
      // for the thing that catches a regression back to per-row loops.**
      // Measured against a loopback database, this file took ~3.35 s under the
      // per-row version and ~0.43 s here: 7.8x apart, and both inside 5 000 ms,
      // which is exactly the "local loopback is marginal, the deployed topology
      // is not close" the audit recorded. Round trips, not wall time, are what
      // separate the two shapes — ~5 000 against 7 for this file — and
      // `tests/import-apply-batching.test.ts` is where that is pinned, without
      // a database and without a clock.
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
