import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPhoneForDisplay,
  normalizePhoneCountry,
  normalizePhoneInput,
} from "../src/common/phone";

describe("phone normalization", () => {
  it("normalizes a national number using the tenant's phone country", () => {
    const result = normalizePhoneInput("067 123 45 67", "UA");

    assert.deepEqual(result, { ok: true, e164: "+380671234567" });
  });

  it("normalizes a '+'-prefixed international number regardless of the tenant country", () => {
    const result = normalizePhoneInput("+49 30 901820", "UA");

    assert.deepEqual(result, { ok: true, e164: "+4930901820" });
  });

  it("rejects garbage input", () => {
    const result = normalizePhoneInput("not a phone", "UA");

    assert.deepEqual(result, { ok: false, reason: "invalid" });
  });

  it("rejects a structurally invalid national number", () => {
    const result = normalizePhoneInput("123", "UA");

    assert.deepEqual(result, { ok: false, reason: "invalid" });
  });

  it("normalizes empty, null and undefined input to a null phone", () => {
    assert.deepEqual(normalizePhoneInput("", "UA"), { ok: true, e164: null });
    assert.deepEqual(normalizePhoneInput("   ", "UA"), {
      ok: true,
      e164: null,
    });
    assert.deepEqual(normalizePhoneInput(null, "UA"), { ok: true, e164: null });
    assert.deepEqual(normalizePhoneInput(undefined, "UA"), {
      ok: true,
      e164: null,
    });
  });

  it("rejects national input for a tenant without a phone country", () => {
    const result = normalizePhoneInput("067 123 45 67", null);

    assert.deepEqual(result, { ok: false, reason: "country_required" });
  });

  it("accepts international input for a tenant without a phone country", () => {
    const result = normalizePhoneInput("+380671234567", null);

    assert.deepEqual(result, { ok: true, e164: "+380671234567" });
  });

  it("rejects non-string input", () => {
    assert.deepEqual(normalizePhoneInput(42, "UA"), {
      ok: false,
      reason: "invalid",
    });
  });

  it("validates ISO alpha-2 phone countries case-insensitively", () => {
    assert.equal(normalizePhoneCountry("ua"), "UA");
    assert.equal(normalizePhoneCountry(" DE "), "DE");
    assert.equal(normalizePhoneCountry("XX"), null);
    assert.equal(normalizePhoneCountry("Ukraine"), null);
    assert.equal(normalizePhoneCountry(null), null);
  });

  it("formats a stored E.164 number nationally when it matches the tenant country", () => {
    assert.equal(formatPhoneForDisplay("+380671234567", "UA"), "067 123 4567");
  });

  it("formats a stored E.164 number internationally when it does not match", () => {
    assert.equal(formatPhoneForDisplay("+4930901820", "UA"), "+49 30 901820");
  });

  it("passes legacy un-normalized values through untouched", () => {
    assert.equal(formatPhoneForDisplay("044-123-45-67 (office)", "UA"), "044-123-45-67 (office)");
  });

  it("returns null for an empty stored value", () => {
    assert.equal(formatPhoneForDisplay(null, "UA"), null);
    assert.equal(formatPhoneForDisplay("", "UA"), null);
  });
});
