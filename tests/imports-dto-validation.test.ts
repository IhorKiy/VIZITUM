import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { PIPES_METADATA } from "@nestjs/common/constants";

import { createStrictValidationPipe } from "../src/common/strict-validation-pipe";
import { ImportsController } from "../src/modules/imports/imports.controller";
import { CreateImportValidationJobDto } from "../src/modules/imports/imports.dto";
import { ImportsService } from "../src/modules/imports/imports.service";
import { IMPORT_TEMPLATE_TYPES } from "../src/modules/imports/imports.types";

// Tier 5 of the class-validator DTO track (2.4 in
// docs/security-remediation-plan.md) — `ImportsController`'s one `@Body()`
// route, and the tier [the design note](../docs/plans/imports-dto-migration-note.md)
// was written for.
//
// The note's Q2 is what most of this file is about: the gate is narrower than
// it looks, and a test that only showed it refusing bad input would
// misrepresent where this endpoint's defenses actually live. So the cases below
// pin what passes at least as carefully as what does not.

function bodyMetadata(): ArgumentMetadata {
  return { type: "body", metatype: CreateImportValidationJobDto, data: "" };
}

async function accept(body: unknown): Promise<CreateImportValidationJobDto> {
  const result = await createStrictValidationPipe().transform(
    body,
    bodyMetadata(),
  );

  assert.ok(result instanceof CreateImportValidationJobDto);

  return result;
}

async function reject(body: unknown, field: string): Promise<void> {
  await assert.rejects(
    createStrictValidationPipe().transform(body, bodyMetadata()),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);

      const response = error.getResponse() as {
        code?: string;
        fieldErrors?: Record<string, string[]>;
      };

      assert.equal(response.code, "VALIDATION_FAILED");
      assert.ok(
        response.fieldErrors?.[field]?.length,
        `expected a field error on ${field}, got ${JSON.stringify(response.fieldErrors)}`,
      );

      return true;
    },
  );
}

// The real template the API serves, not a hand-written approximation — the same
// standard the visits note set for its captured payloads. `ImportsService`'s
// only constructor argument is optional, so the template side of it needs no
// database.
const locationsTemplateCsv = new ImportsService().getTemplateCsv(
  "locations.csv",
).body;

describe("POST /imports/jobs/validate carries the pipe, and the rest of the controller does not", () => {
  it("attaches a pipe to the one body handler and to none of the other four", () => {
    const pipes: unknown[] =
      Reflect.getMetadata(
        PIPES_METADATA,
        ImportsController.prototype.createValidationJob,
      ) ?? [];

    assert.equal(pipes.length, 1, "createValidationJob should carry one pipe");

    // `confirmImportJob` is the case that matters here: it is a POST, so it
    // reads like a write route, but it is addressed entirely by path param and
    // a pipe on it would be a whitelist applied to a body no DTO describes.
    const ungatedHandlers: Array<[string, (...args: never[]) => unknown]> = [
      ["listTemplates", ImportsController.prototype.listTemplates],
      ["downloadTemplate", ImportsController.prototype.downloadTemplate],
      ["listImportJobs", ImportsController.prototype.listImportJobs],
      ["getValidationJob", ImportsController.prototype.getValidationJob],
      ["confirmImportJob", ImportsController.prototype.confirmImportJob],
    ];

    for (const [name, handler] of ungatedHandlers) {
      assert.equal(
        Reflect.getMetadata(PIPES_METADATA, handler),
        undefined,
        `${name} takes no body and should carry no pipe`,
      );
    }
  });
});

describe("what the imports DTO refuses", () => {
  it("refuses an undeclared property — the one thing this gate adds", async () => {
    await reject({ tenantId: "another-tenant" }, "tenantId");
    // The two fields the service supplies itself, from the request context and
    // the parsed file rather than from the body.
    await reject({ sourceFileObjectId: "obj-1" }, "sourceFileObjectId");
  });

  it("gates the discriminator, which picks the header allowlist and the row validator", async () => {
    await reject({ templateType: "locatons" }, "templateType");
    await reject({ templateType: "visits" }, "templateType");

    for (const templateType of IMPORT_TEMPLATE_TYPES) {
      await accept({ templateType, csvText: "a\n" });
    }
  });

  it("refuses a non-string blob or file name", async () => {
    await reject({ csvText: 42 }, "csvText");
    await reject({ csvText: ["a,b"] }, "csvText");
    await reject({ fileName: 42 }, "fileName");
  });
});

describe("what the imports DTO deliberately lets through", () => {
  it("accepts the payload apps/web posts, with a real template body", async () => {
    // From apps/web/lib/api-client.ts `validateCsvImport`, called by the admin
    // imports screen with the file's own text and name.
    const body = await accept({
      templateType: "locations",
      csvText: `${locationsTemplateCsv}Kyiv shop,Kyiv,Main st 1,,,,\n`,
      fileName: "locations-2026-08.csv",
    });

    assert.equal(body.templateType, "locations");
    assert.ok(body.csvText?.includes("\n"));
  });

  it("passes the CSV through byte for byte", async () => {
    // Nothing trims, normalizes newlines or strips quoting on the way past —
    // the parser behind this owns all of that, and a DTO that touched the blob
    // would change what `parseApprovedCsvTemplate` sees.
    const csvText = 'name,city\r\n"Quoted, comma",Kyiv\r\n\r\n';
    const body = await accept({ templateType: "locations", csvText });

    assert.equal(body.csvText, csvText);
  });

  it("lets every field stay omitted, so required-ness stays with the controller", async () => {
    // `IMPORT_TEMPLATE_INVALID` / `IMPORT_FILE_INVALID` from
    // imports.controller.ts's own parsers, not VALIDATION_FAILED here.
    await accept({});
    await accept({ templateType: "users" });
  });

  it("leaves the blank-but-present CSV to parseCsvText", async () => {
    // `"   "` is an empty CSV, and the admin needs to be told that rather than
    // that their string is a string. @IsString() cannot make that call.
    await accept({ templateType: "users", csvText: "   " });
    await accept({ templateType: "users", csvText: "" });
  });

  it("does not inspect the CSV content, which is the note's Q2", async () => {
    // Everything that actually defends an import sits behind this pipe, and
    // these three cases are the ones a reader might wrongly expect the DTO to
    // catch. Each is owned by a different layer, and each of those layers has
    // its own test:
    //
    //   - an undeclared column      -> assertApprovedHeader (import-* tests)
    //   - a formula-injection cell  -> the CSV writer (csv-formula-injection)
    //   - an over-long cell         -> ImportTemplateColumn.limit
    await accept({
      templateType: "locations",
      csvText: "name,city,smuggled\nKyiv shop,Kyiv,x\n",
    });
    await accept({
      templateType: "locations",
      csvText: `name,city\n=cmd|'/c calc'!A0,Kyiv\n`,
    });
    await accept({
      templateType: "locations",
      csvText: `name,city\n${"a".repeat(5_000)},Kyiv\n`,
    });
  });

  it("does not cap the blob, which JSON_BODY_LIMIT already bounds", async () => {
    // A body past 100 kB is refused by body-parser with a 413 before this
    // class is reached; a @MaxLength here would restate that limit and answer
    // with a field error instead.
    await accept({
      templateType: "users",
      csvText: `email\n${"a@b.co\n".repeat(10_000)}`,
    });
  });

  it("does not cap the file name, which parseFileName truncates by design", async () => {
    // Unlike the two upload registrations, which reject an over-long name,
    // parseFileName slices to 255 because the column is purely informational.
    // A cap here would invent a refusal rather than surface one.
    await accept({ fileName: "a".repeat(1_000) });
  });
});
