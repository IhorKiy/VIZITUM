import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportsService } from "../src/modules/imports/imports.service";

// Confirming an import applies every row of the file inside one transaction.
// Each apply* method used to be a `for (const row of rows)` loop issuing 5-7
// awaited queries, so a few-hundred-row file needed thousands of round trips to
// finish inside Prisma's 5 000 ms interactive-transaction default — a
// deterministic 500 on the primary onboarding path, identical on every retry
// (audit F8).
//
// The property that fixes it is not "the apply is fast" — nothing here measures
// time, and a fake transaction could not. It is that **the number of queries an
// apply issues does not depend on the number of rows**: references are resolved
// in grouped lookups and rows are written with createMany. That is what this
// file pins, by applying the same file at 10 rows and at 500 and asserting the
// recorded query sequence is identical.
//
// The apply* methods are private; they are exercised directly here the way
// tests/import-initial-plan-route-reuse.test.ts does, because going through
// confirmImportJob would add the job claim and status write to every count
// without changing what is being measured.

type ApplyImport = (
  transaction: unknown,
  context: unknown,
  parsedFile: unknown,
  counts: unknown,
) => Promise<void>;

type TemplateCase = {
  method: string;
  templateType: string;
  buildRow: (index: number) => Record<string, string>;
  // What a full apply of this template costs in queries, whatever the row
  // count. Written out per template rather than as an upper bound so that a
  // change which reintroduces a per-row query has to restate the number.
  expectedQueryCount: number;
};

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "admin-a",
  roleCodes: ["company_admin"],
  permissions: [],
};

const TEMPLATE_CASES: TemplateCase[] = [
  {
    method: "applyUsersImport",
    templateType: "users",
    buildRow: (index) => ({
      email: `user-${index}@example.com`,
      first_name: `First ${index}`,
      last_name: `Last ${index}`,
      roles: "field_representative",
      phone: "",
    }),
    // tenant phone country, users insert, roles insert
    expectedQueryCount: 3,
  },
  {
    method: "applyLocationsImport",
    templateType: "locations",
    buildRow: (index) => ({
      name: `Store ${index}`,
      address_line: `Address ${index}`,
      city: "Kyiv",
      chain: "Chain A",
      category: "Grocery",
      external_code: `LOC-${index}`,
      assigned_representative_email: `rep-${index % 5}@example.com`,
    }),
    // chains lookup + insert, categories lookup + insert, representatives
    // lookup, locations insert, assignments insert
    expectedQueryCount: 7,
  },
  {
    method: "applyContactsImport",
    templateType: "contacts",
    buildRow: (index) => ({
      location_external_code: `LOC-${index}`,
      name: `Contact ${index}`,
      role_title: "Manager",
      phone: "",
      email: "",
      notes: "",
    }),
    // tenant phone country, locations lookup, contacts insert
    expectedQueryCount: 3,
  },
  {
    method: "applyProductsImport",
    templateType: "products",
    buildRow: (index) => ({
      name: `Product ${index}`,
      external_code: `SKU-${index}`,
      sku: `SKU-${index}`,
      category: "Drinks",
    }),
    // products insert
    expectedQueryCount: 1,
  },
  {
    method: "applyInitialPlanImport",
    templateType: "initial_visit_task_plan",
    buildRow: (index) => ({
      representative_email: `rep-${index % 5}@example.com`,
      location_external_code: `LOC-${index}`,
      plan_date: "2026-08-05",
      sequence: "",
      planned_start_time: "",
      planned_end_time: "",
      task_title: `Task ${index}`,
      task_priority: "priority",
      task_due_date: "2026-08-06",
    }),
    // representatives lookup, locations lookup, plans lookup + insert, route
    // items insert, tasks insert. No routeItem.groupBy: every plan in this
    // file is newly created, so none of them needs an existing-item count.
    expectedQueryCount: 6,
  },
];

describe("import apply: query count is independent of row count", () => {
  for (const templateCase of TEMPLATE_CASES) {
    it(`applies a ${templateCase.templateType} file in ${templateCase.expectedQueryCount} queries at 10 rows and at 500`, async () => {
      const small = await runApply(templateCase, 10);
      const large = await runApply(templateCase, 500);

      assert.deepEqual(small.queries, large.queries);
      assert.equal(small.queries.length, templateCase.expectedQueryCount);

      // The rows themselves still all get written — a constant query count
      // would otherwise be trivially satisfied by writing nothing.
      assert.equal(large.writtenRowCount(), 500);
    });
  }
});

async function runApply(templateCase: TemplateCase, rowCount: number) {
  const recorder = createRecordingTransaction(templateCase.method);
  const counts = buildCounts();
  const service = new ImportsService();
  const apply = (service as unknown as Record<string, ApplyImport>)[
    templateCase.method
  ];

  assert.ok(apply, `${templateCase.method} is missing`);

  await apply.call(
    service,
    recorder.transaction as never,
    context as never,
    {
      templateType: templateCase.templateType,
      columns: [],
      rows: Array.from({ length: rowCount }, (_, index) =>
        templateCase.buildRow(index),
      ),
    } as never,
    counts as never,
  );

  return {
    queries: recorder.queries,
    writtenRowCount: () => recorder.primaryWriteCount,
  };
}

// A transaction fake that records the model and method of every call and
// resolves references consistently, so an apply that batches and an apply that
// loops both complete — and only the recorded sequence tells them apart.
function createRecordingTransaction(method: string) {
  const queries: string[] = [];
  const state = { primaryWriteCount: 0 };
  // The insert whose row count must match the file's, per template. Counted
  // separately from the reference inserts (chains, categories) so a batched
  // apply cannot pass by writing fewer rows than it read.
  const primaryWriteModel: Record<string, string> = {
    applyUsersImport: "user",
    applyLocationsImport: "location",
    applyContactsImport: "locationContact",
    applyProductsImport: "product",
    applyInitialPlanImport: "routeItem",
  };

  function track<TArgs, TResult>(
    model: string,
    operation: string,
    handler: (args: TArgs) => TResult,
  ) {
    return async (args: TArgs): Promise<TResult> => {
      queries.push(`${model}.${operation}`);

      if (
        model === primaryWriteModel[method] &&
        operation.startsWith("createMany")
      ) {
        state.primaryWriteCount += (
          args as unknown as { data: unknown[] }
        ).data.length;
      }

      return handler(args);
    };
  }

  const insertedRows = <TRow>(args: { data: TRow[] }) => ({
    count: args.data.length,
  });

  const transaction = {
    platformTenant: {
      findUniqueOrThrow: track("platformTenant", "findUniqueOrThrow", () => ({
        phoneCountry: "UA",
      })),
    },
    user: {
      createManyAndReturn: track(
        "user",
        "createManyAndReturn",
        (args: { data: { email: string }[] }) =>
          args.data.map((row, index) => ({
            id: `user-${index}`,
            email: row.email,
          })),
      ),
      findMany: track(
        "user",
        "findMany",
        (args: { where: { email: { in: string[] } } }) =>
          args.where.email.in.map((email) => ({ id: `rep-${email}`, email })),
      ),
    },
    userRole: {
      createMany: track("userRole", "createMany", insertedRows),
    },
    chain: {
      findMany: track("chain", "findMany", () => []),
      createManyAndReturn: track(
        "chain",
        "createManyAndReturn",
        (args: { data: { name: string }[] }) =>
          args.data.map((row, index) => ({
            id: `chain-${index}`,
            name: row.name,
          })),
      ),
    },
    locationCategory: {
      findMany: track("locationCategory", "findMany", () => []),
      createManyAndReturn: track(
        "locationCategory",
        "createManyAndReturn",
        (args: { data: { name: string }[] }) =>
          args.data.map((row, index) => ({
            id: `category-${index}`,
            name: row.name,
          })),
      ),
    },
    location: {
      // A plain createMany: the apply mints the ids itself, so there is
      // nothing to read back (see createCuid's own comment).
      createMany: track("location", "createMany", insertedRows),
      findMany: track(
        "location",
        "findMany",
        (args: {
          where: { externalCode?: { in: string[] }; name?: { in: string[] } };
        }) =>
          (args.where.externalCode?.in ?? []).map((externalCode) => ({
            id: `location-${externalCode}`,
            externalCode,
          })),
      ),
    },
    locationAssignment: {
      createMany: track("locationAssignment", "createMany", insertedRows),
    },
    locationContact: {
      createMany: track("locationContact", "createMany", insertedRows),
    },
    product: {
      createMany: track("product", "createMany", insertedRows),
    },
    routePlan: {
      findMany: track("routePlan", "findMany", () => []),
      createManyAndReturn: track(
        "routePlan",
        "createManyAndReturn",
        (args: { data: { representativeUserId: string; planDate: Date }[] }) =>
          args.data.map((plan, index) => ({
            id: `plan-${index}`,
            representativeUserId: plan.representativeUserId,
            planDate: plan.planDate,
          })),
      ),
    },
    routeItem: {
      groupBy: track("routeItem", "groupBy", () => []),
      createMany: track("routeItem", "createMany", insertedRows),
    },
    task: {
      createMany: track("task", "createMany", insertedRows),
    },
  };

  return {
    transaction,
    queries,
    get primaryWriteCount() {
      return state.primaryWriteCount;
    },
  };
}

function buildCounts() {
  return {
    users: 0,
    userRoles: 0,
    chains: 0,
    locationCategories: 0,
    locations: 0,
    locationAssignments: 0,
    contacts: 0,
    products: 0,
    routePlans: 0,
    routeItems: 0,
    tasks: 0,
  };
}
