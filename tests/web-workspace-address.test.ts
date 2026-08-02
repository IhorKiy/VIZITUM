import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INPUT_LIMITS } from "../apps/web/lib/input-limits";
import {
  isWorkspaceEntryPath,
  normalizeWorkspaceInput,
  readSubmittedWorkspace,
  WORKSPACE_ENTRY_PATHS,
  workspaceEntryPath,
} from "../apps/web/lib/workspace-address";

// The workspace entry screen is what replaced the marketing landing's
// hardcoded sign-in link to a demo tenant that only ever existed in a seeded
// local database. It only earns that if it accepts what a reader actually
// has in front of them, which is a link someone sent them — not a slug they
// have been asked to extract by hand.
describe("normalizeWorkspaceInput", () => {
  it("accepts a bare slug", () => {
    assert.equal(normalizeWorkspaceInput("mg"), "mg");
    assert.equal(normalizeWorkspaceInput("vizitum-staging"), "vizitum-staging");
  });

  it("normalizes case and surrounding whitespace", () => {
    assert.equal(
      normalizeWorkspaceInput("  Vizitum-Staging \n"),
      "vizitum-staging",
    );
  });

  it("reads the slug out of a pasted link, whatever the link points at", () => {
    for (const pasted of [
      "https://www.vizitum.com/mg",
      "https://www.vizitum.com/mg/",
      "https://www.vizitum.com/mg/login",
      "http://www.vizitum.com/mg/field",
      "www.vizitum.com/mg/login",
      "vizitum-web.vercel.app/mg",
    ]) {
      assert.equal(normalizeWorkspaceInput(pasted), "mg", pasted);
    }
  });

  it("drops a query string or fragment the link carried", () => {
    assert.equal(
      normalizeWorkspaceInput("https://www.vizitum.com/mg/login?error=invalid"),
      "mg",
    );
    assert.equal(normalizeWorkspaceInput("mg#section"), "mg");
  });

  it("rejects a bare host, which names no workspace", () => {
    // The dot is the whole test for "this is a host, not a slug", so a host
    // with nothing after it has to resolve to nothing rather than to a
    // workspace named after the domain.
    assert.equal(normalizeWorkspaceInput("vizitum.com"), null);
    assert.equal(normalizeWorkspaceInput("https://www.vizitum.com"), null);
    assert.equal(normalizeWorkspaceInput("https://www.vizitum.com/"), null);
  });

  it("rejects anything that is not slug-shaped", () => {
    for (const rejected of [
      "",
      "   ",
      "/",
      "-leading-dash",
      "has space",
      "UPPER_SCORE",
      "робочий-простір",
      // Would otherwise build a protocol-relative URL out of the redirect.
      "\\evil.com",
      "//evil.com",
    ]) {
      assert.equal(normalizeWorkspaceInput(rejected), null, rejected);
    }
  });
});

describe("readSubmittedWorkspace", () => {
  it("hands the last attempt back so a near-miss is edited, not re-typed", () => {
    assert.equal(readSubmittedWorkspace("vizitum-stagin"), "vizitum-stagin");
    // Deliberately not validated: the whole point is to show back something
    // that failed to resolve.
    assert.equal(readSubmittedWorkspace("vizitum.com"), "vizitum.com");
  });

  it("treats nothing worth showing as nothing", () => {
    assert.equal(readSubmittedWorkspace(undefined), null);
    assert.equal(readSubmittedWorkspace(""), null);
    assert.equal(readSubmittedWorkspace("   "), null);
  });

  it("bounds what a hand-edited URL can put in the field", () => {
    const submitted = readSubmittedWorkspace("m".repeat(500));

    assert.equal(submitted?.length, INPUT_LIMITS.slug);
  });

  it("survives a repeated ?workspace=, which arrives as an array", () => {
    // Same case lib/back-navigation.ts guards for ?from=: the page's props
    // declare `string`, and a duplicated param does not honor that.
    assert.equal(readSubmittedWorkspace(["mg", "other"]), null);
  });
});

describe("workspaceEntryPath", () => {
  it("keeps the reader in the language they arrived in", () => {
    assert.equal(workspaceEntryPath("uk"), "/sign-in");
    assert.equal(workspaceEntryPath("en"), "/en/sign-in");
  });

  it("falls back to English for any other locale", () => {
    assert.equal(workspaceEntryPath("de"), "/en/sign-in");
  });

  it("recognizes exactly the two entry paths", () => {
    for (const path of Object.values(WORKSPACE_ENTRY_PATHS)) {
      assert.equal(isWorkspaceEntryPath(path), true, path);
    }

    // The Server Action re-checks its bound path against this before
    // redirecting, so a value that is not one of the two must not pass.
    assert.equal(isWorkspaceEntryPath("/sign-in?next=//evil.com"), false);
    assert.equal(isWorkspaceEntryPath("/mg/login"), false);
  });
});
