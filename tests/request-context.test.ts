import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { getRequestContext } from "../src/modules/tenancy/request-context";

// `getRequestContext` is the guard that makes a handler which lost its
// permission decorator fail closed. It lived as nineteen byte-identical copies,
// one per controller, each of which already imported `RequestContext` from the
// file that now owns the function too (audit F25).
//
// The throw is the load-bearing half. `Request.context` is optional in the
// Express augmentation because it genuinely is absent until the guards have
// run, so the twentieth copy's author would have had to satisfy that optional
// themselves — and the cheapest way past the compiler,
// `return request.context as RequestContext`, hands `tenantId: undefined` to
// every service call. Pass 1 of the audit established what Prisma does with
// that: `where: { tenantId: undefined }` is not an empty result set, it is no
// filter at all.

const CONTEXT = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: [],
  permissions: [],
};

describe("getRequestContext", () => {
  it("returns the context the tenancy layer resolved", () => {
    const request = { context: CONTEXT };

    // The same object, not a copy: callers pass it straight into services that
    // compare identity-free fields, but a clone would quietly decouple a later
    // mutation by a guard.
    assert.equal(getRequestContext(request as never), CONTEXT);
  });

  it("throws when the context was never resolved", () => {
    // This is the 500 that a route missing `@RequireAnyPermissions` produces
    // instead of an unfiltered cross-tenant query.
    assert.throws(() => getRequestContext({} as never), {
      message: "Request context was not initialized.",
    });
    assert.throws(() => getRequestContext({ context: undefined } as never), {
      message: "Request context was not initialized.",
    });
  });
});

// The half that keeps the extraction extracted. Nineteen copies agreed; what
// the finding is about is the twentieth, and nothing but this would notice it.
describe("controllers share the one request-context guard", () => {
  const controllers = findControllers(path.join(import.meta.dirname, "../src"));

  it("finds every controller in the tree", () => {
    // Guards the walk itself: a broken glob would make every assertion below
    // pass over an empty list.
    assert.ok(
      controllers.length >= 19,
      `expected the walk to find the controllers, got ${controllers.length}`,
    );
  });

  it("declares no local copy of getRequestContext", () => {
    const offenders = controllers.filter((file) =>
      /function getRequestContext\b/.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      offenders.map((file) => path.relative(process.cwd(), file)),
      [],
      "a controller declared its own getRequestContext instead of importing the shared one",
    );
  });

  it("reads the context only through that guard", () => {
    // `request.context` touched directly is the other way to reintroduce the
    // gap — it is what the optional type invites, and it skips the throw.
    //
    // The platform-scoped controllers are the documented exceptions: they carry
    // no tenant context at all, so there is nothing for this guard to return,
    // and they read `request.context?` defensively instead. Audit F23 records
    // that these are the controllers which do *not* fail closed on a lost
    // decorator, and closing that is its own item — this test pins the shape
    // that exists rather than pre-empting it.
    //
    // F23 names three; `platform-tenant-superadmin.controller.ts` is a fourth
    // of exactly the same kind, found by this test. Listing it here is what
    // makes the allowlist a statement of the four rather than an unbounded
    // exemption for anything under `platform/`.
    const allowed = new Set([
      "platform.controller.ts",
      "operations.controller.ts",
      "platform-tenant-users.controller.ts",
      "platform-tenant-superadmin.controller.ts",
    ]);
    const offenders = controllers
      .filter((file) => !allowed.has(path.basename(file)))
      .filter((file) => /\brequest\.context\b/.test(readFileSync(file, "utf8")));

    assert.deepEqual(
      offenders.map((file) => path.relative(process.cwd(), file)),
      [],
      "a controller read request.context directly instead of calling getRequestContext",
    );
  });
});

function findControllers(root: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...findControllers(full));
    } else if (entry.name.endsWith(".controller.ts")) {
      found.push(full);
    }
  }

  return found;
}
