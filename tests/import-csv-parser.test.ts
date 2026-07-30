import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { ImportsService } from "../src/modules/imports/imports.service";

describe("import csv parser", () => {
  it("parses an approved users CSV into normalized rows", () => {
    const service = new ImportsService();
    const csv = [
      "\ufeffemail,first_name,last_name,roles,phone,external_code",
      '"Admin@Example.com","Ada","Lovelace","company_admin","+380501112233","EXT-1"',
      '"rep@example.com","Field","""Alpha"" Rep","field_representative",,',
      "",
    ].join("\r\n");

    assert.deepEqual(service.parseApprovedCsvTemplate("users", csv), {
      templateType: "users",
      columns: [
        "email",
        "first_name",
        "last_name",
        "roles",
        "phone",
        "external_code",
      ],
      rows: [
        {
          email: "Admin@Example.com",
          first_name: "Ada",
          last_name: "Lovelace",
          roles: "company_admin",
          phone: "+380501112233",
          external_code: "EXT-1",
        },
        {
          email: "rep@example.com",
          first_name: "Field",
          last_name: '"Alpha" Rep',
          roles: "field_representative",
          phone: "",
          external_code: "",
        },
      ],
    });
  });

  it("rejects CSV headers outside the approved template", () => {
    const service = new ImportsService();

    assert.throws(
      () =>
        service.parseApprovedCsvTemplate(
          "users",
          "email,name,roles,is_admin\nadmin@example.com,Admin,company_admin,true",
        ),
      BadRequestException,
    );
  });

  it("rejects unterminated quoted fields", () => {
    const service = new ImportsService();

    assert.throws(
      () =>
        service.parseApprovedCsvTemplate(
          "users",
          'email,name,roles\nadmin@example.com,"Admin,company_admin',
        ),
      BadRequestException,
    );
  });
});
