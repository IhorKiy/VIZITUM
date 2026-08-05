import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

// Import history is the one admin read that summarizes a tenant's whole
// onboarding: who uploaded what, and how many users/locations/products it
// created. A missing tenant filter here leaks another company's row counts
// and staff names, and the same lookup backs confirm — where reading across
// tenants would not just show another tenant's import but *apply* it.
//
// The store below actually evaluates the `where` it is handed against a
// two-tenant row set, rather than asserting on the object's shape. A service
// that dropped `tenantId` would therefore return the other tenant's rows and
// fail these tests, which asserting on the query alone cannot catch — the
// same stance `tests/auth-tenant-isolation.test.ts` takes for its modules.
describe("import history tenant isolation", () => {
  it("lists only the calling tenant's import jobs", async () => {
    const service = new ImportsService(createStore().prisma as never);

    const ownJobs = await service.listImportJobs({
      tenantId: "tenant-a",
    } as never);

    assert.deepEqual(
      ownJobs.map((job) => job.id),
      ["job-a1"],
    );
    // The applied row counts travel with the job, so pin the one that differs
    // between the two tenants: reading the wrong tenant's summary is its own
    // leak even if the id column somehow looked right.
    assert.equal(ownJobs[0].createdCounts?.users, 3);
  });

  it("does not spill one tenant's import history into another's", async () => {
    const service = new ImportsService(createStore().prisma as never);

    const otherJobs = await service.listImportJobs({
      tenantId: "tenant-b",
    } as never);

    // tenant-b has its own job and must see that one alone — an empty result
    // here would pass a "no cross-tenant rows" assertion while proving the
    // read was broken rather than isolated.
    assert.deepEqual(
      otherJobs.map((job) => job.id),
      ["job-b1"],
    );
    assert.equal(otherJobs[0].createdCounts?.users, 9);
  });

  it("404s instead of showing another tenant's validation preview", async () => {
    const service = new ImportsService(createStore().prisma as never);

    await assert.rejects(
      () =>
        service.getImportValidationJob(
          { tenantId: "tenant-a" } as never,
          "job-b1",
        ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "IMPORT_JOB_NOT_FOUND",
        );

        return true;
      },
    );
  });

  it("404s instead of applying another tenant's import job", async () => {
    // The sharpest case: this path writes rows. A cross-tenant confirm would
    // apply tenant-b's file into whatever tenant the caller belongs to.
    // job-b1 carries a real stored parsed file (see buildJob), so this job is
    // genuinely confirmable — the 404 below is the tenant filter refusing it,
    // not the job being unusable for some other reason.
    const store = createStore();
    const service = new ImportsService(store.prisma as never);

    await assert.rejects(
      () =>
        service.confirmImportJob(
          { tenantId: "tenant-a", userId: "user-a" } as never,
          "job-b1",
        ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "IMPORT_JOB_NOT_FOUND",
        );

        return true;
      },
    );

    // Belt-and-braces. The store's `$transaction` throws a sentinel rather
    // than counting silently, so a confirm that got that far fails the
    // rejection predicate above first — verified by dropping the tenant
    // filter, which reaches the transaction and surfaces that sentinel
    // instead of a NotFoundException.
    assert.equal(store.transactionCount, 0);
  });
});

type StoredJob = {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  rowCount: number;
  validRowCount: number;
  errorRowCount: number;
  warningRowCount: number;
  summary: unknown;
  uploadedBy: { id: string; email: string; name: string } | null;
  confirmedBy: { id: string; email: string; name: string } | null;
  issues: unknown[];
  createdAt: Date;
  validatedAt: Date | null;
  confirmedAt: Date | null;
  appliedAt: Date | null;
  failedAt: Date | null;
};

function buildJob(
  overrides: Partial<StoredJob> & Pick<StoredJob, "id" | "tenantId">,
): StoredJob {
  const timestamp = new Date("2026-08-05T00:00:00.000Z");

  return {
    type: "users",
    status: "validated",
    rowCount: 3,
    validRowCount: 3,
    errorRowCount: 0,
    warningRowCount: 0,
    // `columns`/`rows` are what `parseStoredParsedFile` needs, and they are
    // here on purpose: that parse runs *before* confirm opens its
    // transaction, so a summary without them would make confirm throw early
    // for a reason that has nothing to do with tenancy — and the
    // "never reached the transaction" assertion would then hold no matter
    // how the scoping behaved. With a real stored file, dropping the tenant
    // filter genuinely reaches the transaction, which is what makes that
    // assertion catch something. `appliedCounts` is separate: the history
    // list reads it, and it differs per tenant below.
    summary: {
      appliedCounts: { users: 3 },
      columns: ["email", "firstName", "lastName"],
      rows: [{ email: "rep@tenant-a.local", firstName: "Rep", lastName: "A" }],
    },
    uploadedBy: { id: "user-a", email: "admin@tenant.local", name: "Admin" },
    confirmedBy: null,
    issues: [],
    createdAt: timestamp,
    validatedAt: timestamp,
    confirmedAt: null,
    appliedAt: null,
    failedAt: null,
    ...overrides,
  };
}

function createStore() {
  const jobs: StoredJob[] = [
    buildJob({ id: "job-a1", tenantId: "tenant-a" }),
    buildJob({
      id: "job-b1",
      tenantId: "tenant-b",
      summary: {
        appliedCounts: { users: 9 },
        columns: ["email", "firstName", "lastName"],
        rows: [
          { email: "rep@tenant-b.local", firstName: "Rep", lastName: "B" },
        ],
      },
    }),
  ];

  const store = {
    transactionCount: 0,
    prisma: {
      importJob: {
        // Applies the id/tenantId pair it is given, the way a real scoped
        // query would — this is what makes a dropped tenant filter visible.
        findFirst: async ({
          where,
        }: {
          where: { id?: string; tenantId?: string };
        }) =>
          jobs.find(
            (job) =>
              (where.id === undefined || job.id === where.id) &&
              (where.tenantId === undefined || job.tenantId === where.tenantId),
          ) ?? null,
        findMany: async ({ where }: { where: { tenantId?: string } }) =>
          jobs.filter(
            (job) =>
              where.tenantId === undefined || job.tenantId === where.tenantId,
          ),
      },
      $transaction: async () => {
        store.transactionCount += 1;
        throw new Error(
          "confirm must never reach its transaction for another tenant's job",
        );
      },
    },
  };

  return store;
}
