import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

describe("import templates", () => {
  it("lists downloadable CSV templates for all MVP import types", () => {
    const service = new ImportsService();

    assert.deepEqual(
      service.listTemplates().map((template) => template.type),
      [
        "users",
        "locations",
        "contacts",
        "products",
        "initial_visit_task_plan",
      ],
    );
    assert.equal(
      service.listTemplates()[0]?.downloadPath,
      "/imports/templates/users.csv",
    );
  });

  it("builds the users CSV template with required and optional rows", () => {
    const service = new ImportsService();

    const template = service.getTemplateCsv("users.csv");

    assert.equal(template.fileName, "vizitum-users-template.csv");
    assert.equal(template.contentType, "text/csv; charset=utf-8");
    assert.equal(
      template.body,
      [
        "email,name,roles,phone,external_code",
        '"User email, unique within the tenant.",Full user name.,Comma-separated role codes allowed for this tenant.,Optional phone number.,Optional source-system user identifier.',
        "required,required,required,optional,optional",
        "",
      ].join("\n"),
    );
  });

  it("rejects unsupported template downloads", () => {
    const service = new ImportsService();

    assert.throws(
      () => service.getTemplateCsv("unknown.csv"),
      BadRequestException,
    );
  });
});
