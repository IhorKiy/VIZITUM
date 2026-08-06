import "reflect-metadata";

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import {
  METHOD_METADATA,
  PATH_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
} from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";

import {
  REQUIRED_ANY_PERMISSIONS_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from "../src/modules/auth/permissions.decorator";

// Two properties hold across the whole HTTP surface today, and nothing would
// notice if they stopped (audit F23):
//
//   1. every handler either declares a permission or is one of the documented
//      public routes;
//   2. every handler taking a `@Body()` carries the strict validation pipe and
//      types that body to a DTO class.
//
// The failure this closes: someone adds `POST /tasks/:taskId/notes` with a
// `@Body()` and forgets the pipe, or omits `@RequirePermissions`. `tsc`, lint
// and `format:check` see well-typed code. The eleven `*-dto-validation.test.ts`
// files still pass, because they assert against handler lists that were typed
// out by hand and know nothing about the new route. No test in the suite
// mentions `@RequirePermissions` at all. The endpoint ships accepting
// unvalidated JSON, or accepting it from anyone.
//
// **Derived, never restated.** The point of walking the tree is that a new
// controller is covered the day it is written. Counts are asserted as floors,
// not equalities, so adding a route does not fail this file for the wrong
// reason — the allowlist is where an exception has to be argued.
//
// Method note, because it cost a wrong answer during the audit: do not parse
// decorators with `grep -A 1`. `@RequireAnyPermissions(...)` is frequently
// wrapped across several lines, and a one-line window reports handlers as
// requiring a permission they do not. Reflection reads what Nest itself reads,
// so the question does not arise.

const SRC_ROOT = path.join(import.meta.dirname, "../src");

/**
 * The handlers that are deliberately reachable without a permission.
 *
 * An allowlist rather than a count, for the reason `tests/audit-allowlist.test.ts`
 * uses one: a new exception then has to be written down and argued in a diff,
 * where a number would just be bumped. Every entry is a route that must answer
 * before the caller has any identity to check.
 */
const PUBLIC_HANDLERS: Record<string, string> = {
  // Credentials in, session out — there is no session yet to gate on.
  "AuthController.login": "issues the session",
  "AuthController.acceptInvite": "the invite token is the credential",
  // Read and write the caller's *own* session; the session cookie is the gate.
  "AuthController.me": "reads the caller's own session",
  "AuthController.logout": "ends the caller's own session",
  "AuthController.switchRole": "acts on the caller's own session",
  "AuthController.switchZone": "acts on the caller's own session",
  // Account recovery: by definition reachable by someone who cannot sign in.
  "PasswordController.forgot": "non-enumerating, acknowledges everything",
  "PasswordController.reset": "the reset token is the credential",
  "PasswordController.change": "gated on the session cookie, not a permission",
  // Uptime monitoring calls these anonymously; readiness withholds its
  // operator-only block instead of refusing the request.
  "HealthController.getHealth": "liveness probe",
  "HealthController.getReadiness": "readiness probe, partially redacted",
  // The platform-owner sign-in sequence, same shape as the tenant one.
  "PlatformAuthController.login": "issues the platform challenge",
  "PlatformAuthController.verifyMfa": "second step of that sign-in",
  "PlatformAuthController.completeEnrollment": "second step, first enrolment",
  "PlatformAuthController.me": "reads the caller's own platform session",
  "PlatformAuthController.logout": "ends the caller's own platform session",
  // Pre-auth lookups the sign-in screen needs to render itself.
  "TenancyController.getTenantLocale": "pre-auth, drives the login page locale",
  "TenancyController.getTenantBranding": "pre-auth, drives the login page logo",
};

type Handler = {
  id: string;
  file: string;
  route: string;
  hasPermission: boolean;
  bodyCount: number;
  pipeCount: number;
};

// `require`, not `await import`: this suite transpiles to CJS, where a
// top-level await will not compile. The controllers are CJS here too, so a
// synchronous load is the natural fit and keeps the inventory available to
// every describe below without a shared promise.
const loadController = createRequire(import.meta.url);
const handlers = collectHandlers();

describe("controller surface: every handler is gated or publicly documented", () => {
  it("walks the controller tree and finds the surface", () => {
    // Guards the walk itself. Every assertion below is a filter over this
    // list, so an import that silently yielded nothing would make them all
    // vacuously true.
    assert.ok(
      handlers.length >= 139,
      `expected the walk to find the HTTP surface, got ${handlers.length}`,
    );
  });

  it("declares a permission on every handler that is not documented public", () => {
    const ungated = handlers
      .filter((handler) => !handler.hasPermission)
      .filter((handler) => !(handler.id in PUBLIC_HANDLERS))
      .map((handler) => `${handler.id}  (${handler.route})`);

    assert.deepEqual(
      ungated,
      [],
      "a handler reachable without a permission and without an allowlist entry — " +
        "add the decorator, or add it to PUBLIC_HANDLERS with the reason it must be public",
    );
  });

  it("keeps the public allowlist honest", () => {
    // Both directions. A stale entry is how an allowlist rots into a rubber
    // stamp: the handler gains its decorator, nobody removes the exemption,
    // and the next handler to lose one lands on a name already listed.
    const byId = new Map(handlers.map((handler) => [handler.id, handler]));

    for (const id of Object.keys(PUBLIC_HANDLERS)) {
      const handler = byId.get(id);

      assert.ok(handler, `${id} is allowlisted but no longer exists`);
      assert.equal(
        handler.hasPermission,
        false,
        `${id} now declares a permission — remove it from PUBLIC_HANDLERS`,
      );
    }
  });

  it("does not let the public set grow quietly", () => {
    // The audit measured 18, and that is the whole of what may answer without
    // an identity. Growing it is a decision; this makes it one that has to be
    // taken deliberately rather than by adding a handler and moving on.
    assert.equal(Object.keys(PUBLIC_HANDLERS).length, 18);
  });
});

describe("controller surface: every body is validated", () => {
  const bodyHandlers = handlers.filter((handler) => handler.bodyCount > 0);

  it("finds the body-taking handlers", () => {
    assert.ok(
      bodyHandlers.length >= 69,
      `expected the walk to find the @Body() handlers, got ${bodyHandlers.length}`,
    );
  });

  it("carries the strict validation pipe on every @Body() handler", () => {
    const unpiped = bodyHandlers
      .filter((handler) => handler.pipeCount === 0)
      .map((handler) => `${handler.id}  (${handler.route})`);

    assert.deepEqual(
      unpiped,
      [],
      "a handler takes a @Body() with no @UsePipes(createStrictValidationPipe()) — " +
        "an undeclared property would be accepted instead of refused",
    );
  });

  it("carries no pipe on handlers that take no body", () => {
    // The other direction, and the reason the eleven per-module DTO tests
    // assert it too: a pipe on a bodyless handler is a sign the decorator was
    // pasted onto the wrong method.
    const strays = handlers
      .filter((handler) => handler.bodyCount === 0 && handler.pipeCount > 0)
      .map((handler) => handler.id);

    assert.deepEqual(strays, []);
  });

  // Read from source rather than from `design:paramtypes`, which is empty
  // here. The test runner is `tsx`, and CLAUDE.md records why that matters:
  // esbuild never emits `emitDecoratorMetadata`, so the parameter types Nest
  // relies on at runtime are simply absent under the runner. Reflection can
  // see the pipe and the decorators; it cannot see the type. This is the
  // `tests/input-limits.test.ts` technique — derive the list from the source
  // text instead of restating it — applied to the half reflection cannot
  // reach.
  it("types every @Body() to a DTO class", () => {
    const untyped: string[] = [];

    for (const file of findControllerFiles(SRC_ROOT)) {
      const source = readFileSync(file, "utf8");

      for (const match of source.matchAll(/@Body\(\)\s*([^,)]+)/g)) {
        const declaration = match[1].trim();
        const type = declaration.split(":")[1]?.trim();
        const relative = path.relative(process.cwd(), file);

        if (!type || !/^[A-Z][A-Za-z0-9]*Dto$/.test(type)) {
          untyped.push(`${relative}: @Body() ${declaration}`);
        }
      }
    }

    assert.deepEqual(
      untyped,
      [],
      "a @Body() parameter is not typed to a *Dto class — the pipe validates " +
        "against the declared class, so an inline type or `unknown` makes it a no-op",
    );
  });
});

function collectHandlers(): Handler[] {
  const found: Handler[] = [];

  for (const file of findControllerFiles(SRC_ROOT)) {
    const module: Record<string, unknown> = loadController(file);

    for (const exported of Object.values(module)) {
      if (typeof exported !== "function") {
        continue;
      }

      const controller = exported as { prototype: Record<string, unknown> };
      const basePath = Reflect.getMetadata(PATH_METADATA, exported);

      // Only classes carrying @Controller() — a controller file may also
      // export helpers, DTO types or constants.
      if (basePath === undefined) {
        continue;
      }

      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") {
          continue;
        }

        const handler = controller.prototype[name];

        if (
          typeof handler !== "function" ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        ) {
          continue;
        }

        const routeArgs: Record<string, unknown> =
          Reflect.getMetadata(ROUTE_ARGS_METADATA, exported, name) ?? {};
        const bodyCount = Object.keys(routeArgs).filter((key) =>
          key.startsWith(`${RouteParamtypes.BODY}:`),
        ).length;
        const pipes: unknown[] =
          Reflect.getMetadata(PIPES_METADATA, handler) ?? [];

        found.push({
          id: `${exported.name}.${name}`,
          file: path.relative(process.cwd(), file),
          route: `${basePath}/${Reflect.getMetadata(PATH_METADATA, handler)}`,
          hasPermission: Boolean(
            Reflect.getMetadata(REQUIRED_PERMISSIONS_METADATA, handler) ??
            Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_METADATA, handler),
          ),
          bodyCount,
          pipeCount: pipes.length,
        });
      }
    }
  }

  return found;
}

function findControllerFiles(root: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...findControllerFiles(full));
    } else if (entry.name.endsWith(".controller.ts")) {
      found.push(full);
    }
  }

  return found;
}
