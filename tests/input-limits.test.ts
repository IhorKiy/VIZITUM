import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  JSON_BODY_LIMIT,
  TEXT_LIMITS,
  assertTextWithinLimit,
  resolveLimit,
  withinLimit,
} from "../src/common/input-limits";
import { normalizeEmail } from "../src/common/normalize";
import { normalizeNamePart } from "../src/common/person-name";

// Read as text rather than imported: apps/web is a separate workspace with its
// own tsconfig, and the point of the check is that the two tables agree, not
// that one can import the other.
function readWebLimits(): Record<string, number> {
  const source = readFileSync(
    path.join(process.cwd(), "apps/web/lib/input-limits.ts"),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("INPUT_LIMITS = {") + "INPUT_LIMITS = {".length,
    source.lastIndexOf("} as const;"),
  );
  const limits: Record<string, number> = {};

  for (const [, key, value] of body.matchAll(/^\s*(\w+):\s*(\d+),/gm)) {
    limits[key] = Number(value);
  }

  return limits;
}

describe("input limits", () => {
  it("mirrors the web app's maxLength table, key for key", () => {
    // The browser's maxLength is a courtesy to the person typing; these are
    // the control. They have to agree, or a field the UI accepts is rejected
    // by the API (or worse, the other way round).
    assert.deepEqual(readWebLimits(), { ...TEXT_LIMITS });
  });

  it("resolves a key or a plain number", () => {
    assert.equal(resolveLimit("name"), TEXT_LIMITS.name);
    assert.equal(resolveLimit(42), 42);
  });

  it("accepts a value at the cap and rejects one past it", () => {
    assert.equal(withinLimit("x".repeat(TEXT_LIMITS.name), "name"), true);
    assert.equal(withinLimit("x".repeat(TEXT_LIMITS.name + 1), "name"), false);
  });

  it("rejects rather than truncates, with the caller's own error code", () => {
    // Silently storing half of what someone typed is a data-loss bug wearing
    // a security fix's clothes.
    assert.throws(
      () =>
        assertTextWithinLimit(
          "x".repeat(TEXT_LIMITS.name + 1),
          "name",
          "name",
          "LOCATION_INVALID",
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const payload = error.getResponse() as {
          code?: string;
          fieldErrors?: Record<string, string[]>;
        };

        assert.equal(payload.code, "LOCATION_INVALID");
        assert.ok(payload.fieldErrors?.name?.[0]);

        return true;
      },
    );
  });

  it("returns the value unchanged when it fits", () => {
    assert.equal(
      assertTextWithinLimit("Acme Foods", "name", "name", "CHAIN_INVALID"),
      "Acme Foods",
    );
  });

  it("states the JSON body ceiling instead of inheriting body-parser's", () => {
    // Same size the API relied on by accident until now, but a decision a
    // dependency bump cannot move.
    assert.equal(JSON_BODY_LIMIT, "100kb");
  });
});

describe("shared normalizers enforce their caps", () => {
  it("treats an over-length email as not an email", () => {
    const localPart = "a".repeat(TEXT_LIMITS.email);

    assert.equal(normalizeEmail(`${localPart}@example.com`), null);
    assert.equal(normalizeEmail("  Rep@Example.COM "), "rep@example.com");
  });

  it("rejects an over-length name part the way it rejects a blank one", () => {
    assert.equal(normalizeNamePart("x".repeat(TEXT_LIMITS.name + 1)), null);
    assert.equal(normalizeNamePart("  Олена   Ковальчук "), "Олена Ковальчук");
  });
});
