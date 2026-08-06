import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { VisitCancellationReason } from "@prisma/client";

import { resolveCookieName } from "../src/common/cookie-naming";
import { VISIT_DATE_BACKDATE_WINDOW_DAYS } from "../src/modules/visits/shelf-check";

// `apps/web` is a separate npm workspace with its own tsconfig and cannot
// import from the backend, so a handful of values exist twice under a comment
// asking a human to keep them in step. Five such pairs exist; one —
// `INPUT_LIMITS` — was enforced, by `tests/input-limits.test.ts`. The other
// four were not (audit F15).
//
// All four agreed when this was written, so this is a drift guard rather than
// a fix. What it is guarding against, per pair:
//
//   - `resolveCookieName` is the sharpest. If the backend's rule changed and
//     this copy did not, the API would set one cookie name in production while
//     `apps/web` cleared another: logout would appear to work and leave a live
//     session behind.
//   - `VISIT_DATE_BACKDATE_WINDOW_DAYS` fails asymmetrically. A *narrowed*
//     backend window leaves the date picker offering days the server will
//     refuse, so a rep finishes a whole report and is refused at confirm.
//   - `VisitCancellationReason` diverging means a reason the picker offers and
//     the API rejects, on a screen a rep reaches when a visit already went
//     wrong.
//   - `PENDING_MEDIA_MAX_AGE_MS` bounds how stale a device-supplied visit start
//     may be; if the device kept work longer than the server would accept it,
//     the queue would hold sends that can only ever be refused.
//
// Read as text rather than imported, for the reason `tests/input-limits.test.ts`
// gives in its own comment: the point of the check is that the two sides agree,
// not that one can reach the other.

const WEB_ROOT = path.join(import.meta.dirname, "../apps/web");

function readWeb(relative: string): string {
  return readFileSync(path.join(WEB_ROOT, relative), "utf8");
}

describe("cross-workspace constants: the frontend copies still agree", () => {
  it("mirrors the visit backdate window", () => {
    const source = readWeb("components/field-visit-report-form.tsx");
    const match = source.match(
      /const VISIT_DATE_BACKDATE_WINDOW_DAYS = (\d+);/,
    );

    assert.ok(match, "the frontend copy was renamed or removed");
    assert.equal(Number(match[1]), VISIT_DATE_BACKDATE_WINDOW_DAYS);
  });

  it("mirrors the cancellation reasons, token for token", () => {
    // The Prisma enum is the authority — the backend's own list is derived
    // from it — so the frontend union is compared against that rather than
    // against a second hand-written copy.
    const source = readWeb("lib/api-client.ts");
    const declaration = source.slice(
      source.indexOf("export type VisitCancellationReason ="),
    );
    const union = declaration.slice(0, declaration.indexOf(";"));
    const webReasons = [...union.matchAll(/"([a-z_]+)"/g)]
      .map(([, token]) => token)
      .sort();

    assert.deepEqual(webReasons, Object.keys(VisitCancellationReason).sort());
  });

  it("mirrors the on-device retention the deferred-start window is set from", () => {
    const webValue = evaluateMs(
      readWeb("lib/offline-drafts.ts"),
      "PENDING_MEDIA_MAX_AGE_MS",
    );
    // Private to the service, so read as text on this side too rather than
    // exported purely to be asserted on.
    const backendValue = evaluateMs(
      readFileSync(
        path.join(
          import.meta.dirname,
          "../src/modules/visits/visits.service.ts",
        ),
        "utf8",
      ),
      "MAX_DEFERRED_VISIT_START_AGE_MS",
    );

    assert.equal(webValue, backendValue);
    assert.equal(webValue, 7 * 24 * 60 * 60 * 1000);
  });

  // Behaviour, not text. This pair duplicates a *rule* rather than a value, so
  // matching the source line for line would pass on a copy that reads the same
  // and does something else. The frontend's function is lifted out and run
  // against the same inputs as the backend's, with `process` injected because
  // its copy reads `process.env.NODE_ENV` directly.
  it("applies the same cookie-naming rule as the backend", () => {
    const applyWebRule = loadWebCookieRule();
    const cases: Array<[string | undefined, string, string | undefined]> = [
      ["production", "vizitum_session", undefined],
      ["production", "vizitum_session", "vizitum_session_wt1"],
      ["production", "vizitum_csrf", "   "],
      ["development", "vizitum_session", undefined],
      ["development", "vizitum_session", "vizitum_session_wt1"],
      ["development", "vizitum_session", "   "],
      ["test", "vizitum_csrf", "override"],
      [undefined, "vizitum_session", "vizitum_session_wt1"],
    ];

    for (const [nodeEnv, baseName, devOverride] of cases) {
      assert.equal(
        applyWebRule(nodeEnv, baseName, devOverride),
        resolveCookieName(baseName, devOverride, {
          NODE_ENV: nodeEnv,
        } as NodeJS.ProcessEnv),
        `disagreed on NODE_ENV=${nodeEnv}, base=${baseName}, override=${devOverride}`,
      );
    }

    // The two facts the rule exists for, asserted directly so a pair that
    // agreed on something *wrong* still fails.
    assert.equal(
      applyWebRule("production", "vizitum_session", "ignored"),
      "__Host-vizitum_session",
    );
    assert.equal(
      applyWebRule("development", "vizitum_session", "ignored"),
      "ignored",
    );
  });
});

/** The value of a `const NAME = <arithmetic>;` declaration, evaluated. */
function evaluateMs(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = ([\\d\\s*+]+);`));

  assert.ok(match, `${name} was renamed or removed`);

  const value = Number(
    new Function(`return ${match[1]};`)() as unknown as number,
  );

  assert.ok(Number.isFinite(value), `${name} did not evaluate to a number`);

  return value;
}

/**
 * The frontend's `resolveCookieName`, lifted out of its module and made
 * callable here.
 *
 * `api-client.ts` cannot be imported — separate workspace, and it pulls in the
 * whole Next server runtime — so the function's own source is extracted and
 * rebuilt with `process` passed in. That keeps the comparison behavioural: a
 * copy that is reworded but equivalent passes, and one that reads the same and
 * behaves differently does not.
 */
function loadWebCookieRule(): (
  nodeEnv: string | undefined,
  baseName: string,
  devOverride?: string,
) => string {
  const source = readWeb("lib/api-client.ts");
  const start = source.indexOf("function resolveCookieName(");

  assert.notEqual(start, -1, "the frontend copy was renamed or removed");

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let end = bodyStart;

  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const body = source.slice(bodyStart + 1, end);
  const rule = new Function("process", "baseName", "devOverride", body) as (
    fakeProcess: { env: { NODE_ENV?: string } },
    baseName: string,
    devOverride?: string,
  ) => string;

  return (nodeEnv, baseName, devOverride) =>
    rule({ env: { NODE_ENV: nodeEnv } }, baseName, devOverride);
}
