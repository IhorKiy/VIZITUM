import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

import { ImportsService } from "../src/modules/imports/imports.service";
import type { ImportTemplateType } from "../src/modules/imports/imports.types";

const samplePackRoot = join(
  process.cwd(),
  "docs",
  "samples",
  "import-packs",
  "first-pilot",
);

describe("first pilot import sample pack", () => {
  it("uses approved headers and parseable rows for every import template", () => {
    const service = new ImportsService();
    const templates = service.listTemplates();

    for (const template of templates) {
      const samplePath = join(samplePackRoot, `${template.type}.csv`);
      const sampleCsv = readFileSync(samplePath, "utf8");
      const parsed = service.parseApprovedCsvTemplate(
        template.type as ImportTemplateType,
        sampleCsv,
      );
      const approvedHeader = service
        .getTemplateCsv(`${template.type}.csv`)
        .body.split("\n")[0]
        ?.split(",");

      assert.deepEqual(parsed.columns, approvedHeader);
      assert.ok(parsed.rows.length > 0, `${template.type} sample has rows`);
    }
  });
});
