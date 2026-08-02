import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeCsvCell as escapeBackendCsvCell } from "../src/modules/imports/imports.service";
import { escapeCsvCell, toCsv } from "../apps/web/lib/csv";

// A CSV export is a file someone opens in Excel or Sheets, and those evaluate
// a cell that starts with `=`, `+`, `-` or `@` as a formula. The manager
// dashboard's export is built from tenant-entered names — a representative's,
// a location's, a task's — so without this an attacker who can name something
// can run a formula on the manager's machine. Quoting alone does not help:
// quotes are the file format's own delimiter and are stripped before the cell
// is interpreted.
describe("csv formula injection", () => {
  it("neutralizes every leading character a spreadsheet treats as a formula", () => {
    for (const value of [
      "=cmd|'/c calc'!A0",
      "+1+1",
      "@SUM(A1:A2)",
      "=HYPERLINK(\"http://evil.example\",\"Click\")",
      "\tleading tab",
      "\rleading carriage return",
    ]) {
      const cell = escapeCsvCell(value);

      assert.ok(
        cell.startsWith(`"'`),
        `expected ${JSON.stringify(value)} to be prefixed, got ${cell}`,
      );
    }
  });

  it("leaves a negative number alone, so the export keeps its numbers", () => {
    // The alternative — prefixing every leading `-` — turns each negative
    // number in the sheet into text, which is a real cost paid on every
    // export for no gain: a value that parses as a number cannot be a
    // formula.
    assert.equal(escapeCsvCell("-5"), '"-5"');
    assert.equal(escapeCsvCell("-12.5"), '"-12.5"');
    assert.equal(escapeCsvCell("-12,5"), '"-12,5"');

    // Something that merely starts like one is still guarded.
    assert.equal(
      escapeCsvCell("-2+3+cmd|'/c calc'!A0"),
      `"'-2+3+cmd|'/c calc'!A0"`,
    );
  });

  it("still escapes the things CSV itself needs escaped", () => {
    assert.equal(escapeCsvCell('He said "hello"'), '"He said ""hello"""');
    assert.equal(escapeCsvCell("Kyiv, north"), '"Kyiv, north"');
    assert.equal(escapeCsvCell("line\nbreak"), '"line\nbreak"');
    assert.equal(escapeCsvCell(""), '""');
  });

  it("builds a row per line and a cell per column", () => {
    assert.equal(
      toCsv([
        ["Section", "Name"],
        ["Representative", "=1+1"],
      ]),
      '"Section","Name"\n"Representative","\'=1+1"',
    );
  });

  it("keeps the backend template writer in step with the web one", () => {
    // Two copies exist because the API and the web app are separate
    // workspaces (the same arrangement phone.ts uses). The rules must not
    // drift, so they are checked against each other here rather than trusted
    // to stay identical by inspection.
    for (const value of [
      "=cmd|'/c calc'!A0",
      "+1",
      "@SUM(A1:A2)",
      "-2+3+cmd|'/c calc'!A0",
    ]) {
      assert.ok(
        escapeBackendCsvCell(value).startsWith("'"),
        `expected the backend writer to guard ${JSON.stringify(value)}`,
      );
    }

    assert.equal(escapeBackendCsvCell("-5"), "-5");
    assert.equal(escapeBackendCsvCell("plain"), "plain");
  });
});
