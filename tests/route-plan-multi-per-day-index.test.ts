import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// RoutePlan's (tenantId, representativeUserId, planDate) uniqueness is
// enforced by TWO partial unique indexes — one scoped to
// `routeTemplateId IS NOT NULL` (a representative can hold several
// template-based plans on the same day, but not the same template twice)
// and one scoped to `routeTemplateId IS NULL` (still at most one
// template-less manual plan per day) — which Prisma can't express in
// schema.prisma. They therefore live only in a raw-SQL migration and are
// invisible to Prisma's schema<->DB diff — so a future `prisma migrate dev`
// for an unrelated change can silently emit a `DROP INDEX` for either, or
// someone can reintroduce a plain `@@unique`, either of which quietly
// breaks the invariant (or resurrects the old one-route-per-day limit).
// These guards fail CI in that case instead of losing the behavior at
// runtime. Mirrors tests/location-external-code-index.test.ts.

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");
const TEMPLATE_INDEX_NAME = "route_plans_rep_date_template_key";
const NO_TEMPLATE_INDEX_NAME = "route_plans_rep_date_no_template_key";

function migrationSqlInOrder(): string {
  return (
    readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Directory names are timestamp-prefixed, so lexical sort == apply order.
      .sort()
      .map((name) =>
        readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
      )
      .join("\n")
  );
}

function routePlanModelBlock(): string {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const match = schema.match(/\nmodel RoutePlan \{[\s\S]*?\n\}/);
  assert.ok(match, "RoutePlan model must exist in schema.prisma");
  // Drop `//` comment lines so the warning comment (which quotes the
  // forbidden declaration) isn't mistaken for a real one.
  return match[0]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function assertPartialIndex(sql: string, indexName: string, whereClause: RegExp) {
  const createAt = sql.lastIndexOf(`CREATE UNIQUE INDEX "${indexName}"`);

  assert.notEqual(
    createAt,
    -1,
    `a migration must CREATE the partial unique index "${indexName}"`,
  );

  const statement = sql.slice(createAt, sql.indexOf(";", createAt));
  assert.match(
    statement,
    whereClause,
    `index "${indexName}" must be partial with the expected WHERE clause, not a plain unique`,
  );

  const lastDrop = sql.lastIndexOf(`DROP INDEX "${indexName}"`);
  assert.ok(
    createAt > lastDrop,
    `index "${indexName}" must exist after the last migration — a later ` +
      `DROP INDEX (likely from an auto-generated migration) removed it. ` +
      `Re-add the partial index in that migration.`,
  );
}

describe("route plan multi-per-day partial unique indexes", () => {
  it("route_plans_rep_date_template_key is partial, scoped to routeTemplateId IS NOT NULL, and survives later migrations", () => {
    assertPartialIndex(
      migrationSqlInOrder(),
      TEMPLATE_INDEX_NAME,
      /WHERE\s+"routeTemplateId"\s+IS\s+NOT\s+NULL/,
    );
  });

  it("route_plans_rep_date_no_template_key is partial, scoped to routeTemplateId IS NULL, and survives later migrations", () => {
    assertPartialIndex(
      migrationSqlInOrder(),
      NO_TEMPLATE_INDEX_NAME,
      /WHERE\s+"routeTemplateId"\s+IS\s+NULL/,
    );
  });

  it("is not shadowed by a plain @@unique in schema.prisma", () => {
    // A plain `@@unique([tenantId, representativeUserId, planDate])` would
    // make Prisma manage a NON-partial unique index again (capping a
    // representative at one route plan per day) and would drive the
    // auto-generated DROP of both partial ones.
    assert.doesNotMatch(
      routePlanModelBlock(),
      /@@unique\(\[tenantId,\s*representativeUserId,\s*planDate\]\)/,
      "RoutePlan must not declare @@unique([tenantId, representativeUserId, planDate]); " +
        "uniqueness is the two partial indexes in the migration",
    );
  });
});
