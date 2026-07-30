import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  tenantDisplayName,
  tenantNameFromSlug,
} from "../apps/web/lib/navigation";

// The workspace name on the login panel, the invite screen, the zone chooser
// and the app shell is the name the tenant was created under — rendered
// character for character. Deriving it from the slug (which is lowercase by
// construction) title-cased it, so a tenant named "MG" read "Mg" everywhere.
describe("tenantDisplayName", () => {
  it("renders the stored name verbatim, including all-caps", () => {
    assert.equal(tenantDisplayName("MG", "mg"), "MG");
  });

  it("does not touch inner capitals or punctuation", () => {
    assert.equal(
      tenantDisplayName("ТОВ «АгроМІКС»", "agromiks"),
      "ТОВ «АгроМІКС»",
    );
  });

  it("falls back to the slug when the branding lookup gave nothing", () => {
    assert.equal(tenantDisplayName(null, "acme-foods"), "Acme Foods");
    assert.equal(tenantDisplayName(undefined, "acme-foods"), "Acme Foods");
    assert.equal(tenantDisplayName("   ", "acme-foods"), "Acme Foods");
  });

  it("keeps surrounding whitespace out of the rendered name", () => {
    assert.equal(tenantDisplayName("  MG  ", "mg"), "MG");
  });
});

describe("tenantNameFromSlug", () => {
  it("humanizes a slug into words", () => {
    assert.equal(tenantNameFromSlug("acme-foods"), "Acme Foods");
  });

  it("survives a slug with empty segments", () => {
    assert.equal(tenantNameFromSlug("--acme--foods--"), "Acme Foods");
  });
});
