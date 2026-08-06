import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ImportsService } from "../src/modules/imports/imports.service";
import type { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  createTestPrisma,
  createTestTenant,
  createTestUser,
  purgeTestTenant,
  skipWithoutDatabase,
} from "./fixtures/database";

// The release-readiness list has carried "[x] Import failure cannot partially
// corrupt applied data" with nothing executable behind it. `confirmImportJob`
// does wrap every apply in one `prisma.$transaction`, and reading the code is
// good reason to believe it — but a tick that rests on a reading reads as
// tested to every future reviewer, and the fakes this suite is built on cannot
// tell the difference: each is `async (callback) => callback({…})`, so a throw
// inside one propagates with nothing to undo (audit F24).
//
// This is the gate, executed. The failure is introduced the way it actually
// happens rather than by stubbing a rejection: a location's external code is
// taken by someone else *between* validation and confirm. Validation passed —
// `validateLocationsPreview` checked the codes and found them free — so the
// conflict only exists at write time, which is exactly the window audit F11
// describes and the one a preview cannot close.
//
// What makes it a real test of the gate rather than of the error: by the time
// the locations insert fails, the apply has **already written** the chains and
// categories the file introduced. Those are the rows that must not survive.

describe(
  "import apply rolls back completely when a row fails",
  { skip: skipWithoutDatabase },
  () => {
    let prisma: PrismaService;
    let tenantId: string;
    let adminUserId: string;

    before(async () => {
      prisma = createTestPrisma();
      await prisma.$connect();

      const tenant = await createTestTenant(prisma, "import-rollback");

      tenantId = tenant.tenantId;
      adminUserId = await createTestUser(
        prisma,
        tenantId,
        "rollback-admin@example.com",
        "company_admin",
      );
    });

    after(async () => {
      if (tenantId) {
        await purgeTestTenant(prisma, tenantId);
      }

      await prisma.$disconnect();
    });

    it("leaves no chain, category or location behind when the apply fails", async () => {
      const service = new ImportsService(prisma);
      const context = {
        requestId: "request-rollback",
        tenantId,
        tenantSlug: "import-rollback",
        userId: adminUserId,
        roleCodes: ["company_admin"],
        permissions: [],
      };
      const csv = [
        "name,address_line,city,chain,category,external_code",
        "Store A,Addr A,Kyiv,Rollback Chain,Rollback Category,ROLL-1",
        "Store B,Addr B,Lviv,Rollback Chain,Rollback Category,ROLL-2",
        "",
      ].join("\n");

      const preview = await service.createImportValidationJob(
        context as never,
        service.parseApprovedCsvTemplate("locations", csv),
      );

      // Validation is clean: at this moment both codes are free.
      assert.equal(preview.canConfirm, true);
      assert.equal(preview.errorRowCount, 0);

      // Someone else takes ROLL-2 before the admin presses Confirm. A partial
      // unique index on (tenantId, externalCode) where deletedAt IS NULL makes
      // the import's own insert fail on it.
      await prisma.location.create({
        data: {
          tenantId,
          name: "Taken by someone else",
          addressLine: "Addr X",
          city: "Odesa",
          externalCode: "ROLL-2",
        },
        select: { id: true },
      });

      await assert.rejects(() =>
        service.confirmImportJob(context as never, preview.importJobId),
      );

      // The gate. The chain and the category were created earlier in the same
      // transaction, before the locations insert that failed — a rollback that
      // did not reach them would leave the tenant holding dictionary rows for
      // an import that never applied, which is precisely "partially corrupt
      // applied data".
      assert.equal(
        await prisma.chain.count({ where: { tenantId } }),
        0,
        "the auto-created chain survived a failed import",
      );
      assert.equal(
        await prisma.locationCategory.count({ where: { tenantId } }),
        0,
        "the auto-created category survived a failed import",
      );

      const locations = await prisma.location.findMany({
        where: { tenantId },
        select: { externalCode: true },
      });

      // Only the row this test wrote outside the import. Neither ROLL-1 (which
      // the apply reached and inserted before failing on ROLL-2) nor ROLL-2
      // may exist.
      assert.deepEqual(
        locations.map((location) => location.externalCode),
        ["ROLL-2"],
      );

      // And the job did not claim to have applied. The status claim is inside
      // the transaction too, so it has to have rolled back with everything
      // else — otherwise the file could never be retried after the conflict is
      // cleared.
      const job = await prisma.importJob.findUniqueOrThrow({
        where: { id: preview.importJobId },
        select: { status: true, appliedAt: true },
      });

      assert.equal(job.status, "validated");
      assert.equal(job.appliedAt, null);
    });
  },
);
