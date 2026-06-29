import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

describe("import xlsx parser", () => {
  it("parses an approved users workbook into normalized rows", () => {
    const service = new ImportsService();
    const workbookPath = createWorkbook([
      ["email", "name", "roles", "phone", "external_code"],
      [
        "Admin@Example.com",
        "Ada Lovelace",
        "company_admin",
        "+380501112233",
        "EXT-1",
      ],
      ["rep@example.com", "Field Rep", "field_representative", "", ""],
    ]);

    assert.deepEqual(service.parseApprovedXlsxTemplate("users", workbookPath), {
      templateType: "users",
      columns: ["email", "name", "roles", "phone", "external_code"],
      rows: [
        {
          email: "Admin@Example.com",
          name: "Ada Lovelace",
          roles: "company_admin",
          phone: "+380501112233",
          external_code: "EXT-1",
        },
        {
          email: "rep@example.com",
          name: "Field Rep",
          roles: "field_representative",
          phone: "",
          external_code: "",
        },
      ],
    });
  });

  it("rejects workbooks with headers outside the approved template", () => {
    const service = new ImportsService();
    const workbookPath = createWorkbook([
      ["email", "name", "roles", "is_admin"],
      ["admin@example.com", "Admin", "company_admin", "true"],
    ]);

    assert.throws(
      () => service.parseApprovedXlsxTemplate("users", workbookPath),
      BadRequestException,
    );
  });
});

function createWorkbook(rows: string[][]): string {
  const root = mkdtempSync(join(tmpdir(), "vizitum-xlsx-"));
  const xlsxPath = join(root, "workbook.xlsx");

  mkdirSync(join(root, "_rels"));
  mkdirSync(join(root, "xl", "_rels"), { recursive: true });
  mkdirSync(join(root, "xl", "worksheets"), { recursive: true });

  writeFileSync(join(root, "[Content_Types].xml"), contentTypesXml());
  writeFileSync(join(root, "_rels", ".rels"), rootRelationshipsXml());
  writeFileSync(join(root, "xl", "workbook.xml"), workbookXml());
  writeFileSync(
    join(root, "xl", "_rels", "workbook.xml.rels"),
    workbookRelationshipsXml(),
  );
  writeFileSync(
    join(root, "xl", "worksheets", "sheet1.xml"),
    worksheetXml(rows),
  );

  execFileSync("/usr/bin/zip", [
    "-qr",
    xlsxPath,
    "[Content_Types].xml",
    "_rels",
    "xl",
  ], {
    cwd: root,
  });

  return xlsxPath;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Import" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function worksheetXml(rows: string[][]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.map((row, index) => rowXml(row, index + 1)).join("\n")}
  </sheetData>
</worksheet>`;
}

function rowXml(row: string[], rowNumber: number): string {
  return `<row r="${rowNumber}">${row
    .map((value, index) => {
      const reference = `${columnName(index)}${rowNumber}`;

      return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .join("")}</row>`;
}

function columnName(index: number): string {
  let columnNumber = index + 1;
  let name = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return name;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
