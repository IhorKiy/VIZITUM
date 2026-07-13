import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Product's (tenantId, externalCode) uniqueness is enforced by a PARTIAL unique
// index scoped to `deletedAt IS NULL`, which Prisma can't express in
// schema.prisma. It therefore lives only in a raw-SQL migration and is invisible
// to Prisma's schema<->DB diff — so a future `prisma migrate dev` for an
// unrelated change can silently emit a `DROP INDEX` for it, or someone can
// reintroduce a plain `@@unique`, either of which quietly breaks the invariant.
// These guards fail CI in that case instead of losing uniqueness at runtime.

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");
const SCHEMA_PATH = path.join(REPO_ROOT, "prisma", "schema.prisma");
const INDEX_NAME = "products_tenantId_externalCode_live_key";

function migrationSqlInOrder(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Directory names are timestamp-prefixed, so lexical sort == apply order.
    .sort()
    .map((name) =>
      readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
    )
    .join("\n");
}

function productModelBlock(): string {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const match = schema.match(/\nmodel Product \{[\s\S]*?\n\}/);
  assert.ok(match, "Product model must exist in schema.prisma");
  // Drop `//` comment lines so the warning comment (which quotes the forbidden
  // declaration) isn't mistaken for a real one.
  return match[0]
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("product externalCode partial unique index", () => {
  it("is created as a partial index scoped to deletedAt IS NULL", () => {
    const sql = migrationSqlInOrder();
    const createAt = sql.lastIndexOf(`CREATE UNIQUE INDEX "${INDEX_NAME}"`);

    assert.notEqual(
      createAt,
      -1,
      `a migration must CREATE the partial unique index "${INDEX_NAME}"`,
    );

    const statement = sql.slice(createAt, sql.indexOf(";", createAt));
    assert.match(
      statement,
      /WHERE\s+"deletedAt"\s+IS\s+NULL/,
      "the index must be partial (WHERE deletedAt IS NULL), not a plain unique",
    );
  });

  it("is not left dropped by any later migration (drift guard)", () => {
    const sql = migrationSqlInOrder();
    const lastCreate = sql.lastIndexOf(`CREATE UNIQUE INDEX "${INDEX_NAME}"`);
    const lastDrop = sql.lastIndexOf(`DROP INDEX "${INDEX_NAME}"`);

    // If a future auto-generated migration drops the index without recreating it
    // (the schema-drift failure mode), its DROP would land after the CREATE.
    assert.ok(
      lastCreate > lastDrop,
      `index "${INDEX_NAME}" must exist after the last migration — a later ` +
        `DROP INDEX (likely from an auto-generated migration) removed it. ` +
        `Re-add the partial index in that migration.`,
    );
  });

  it("is not shadowed by a plain @@unique in schema.prisma", () => {
    // A plain `@@unique([tenantId, externalCode])` would make Prisma manage a
    // NON-partial unique index (reserving soft-deleted codes) and would drive
    // the auto-generated DROP of the partial one.
    assert.doesNotMatch(
      productModelBlock(),
      /@@unique\(\[tenantId,\s*externalCode\]\)/,
      "Product must not declare @@unique([tenantId, externalCode]); uniqueness " +
        "is the partial index in the migration",
    );
  });
});
