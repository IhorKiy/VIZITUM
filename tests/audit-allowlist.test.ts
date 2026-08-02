import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateAudit } from "../scripts/audit-check.mjs";

// The gate that decides whether a dependency advisory blocks CI. A bare
// `npm audit --audit-level=high` cannot do the job: three high advisories are
// open and unfixable, so it would be red from the first commit and everyone
// would learn to ignore it. This one asks the useful question instead — is
// there an advisory nobody has looked at — which only works if "looked at" is
// pinned narrowly. These cases are what stop it drifting back into a rubber
// stamp.
describe("dependency advisory gate", () => {
  it("passes the advisories that were read and judged", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        postcss: {
          severity: "high",
          via: [
            {
              source: 1117015,
              url: "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
            },
          ],
        },
      },
    });

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks an advisory nobody has read, in a package that is otherwise accepted", () => {
    // The case a package-name allowlist would wave through: postcss is on the
    // list, but this is a different finding than the ones that were judged.
    const result = evaluateAudit({
      vulnerabilities: {
        postcss: {
          severity: "high",
          via: [
            { source: 1117015, url: "known" },
            { source: 9999999, title: "Something new", url: "unread" },
          ],
        },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "postcss");
    assert.match(result.blocking[0]?.detail ?? "", /Something new/);
  });

  it("blocks a package that has never been reviewed", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        lodash: {
          severity: "critical",
          via: [{ source: 4242, title: "Prototype pollution", url: "u" }],
        },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "lodash");
  });

  it("accepts a parent listed only for what it depends on", () => {
    // `next` is reported because postcss and sharp are under it. While its
    // `via` is nothing but package names, it carries no advisory of its own.
    const result = evaluateAudit({
      vulnerabilities: {
        next: { severity: "high", via: ["postcss", "sharp"] },
      },
    });

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks that same parent the moment it has a finding of its own", () => {
    // This is the tripwire the plan describes in prose: an object in `via`
    // rather than a string means next itself is affected, which is a decision
    // to make rather than a transitive fact to wave through.
    const result = evaluateAudit({
      vulnerabilities: {
        next: {
          severity: "high",
          via: [
            "postcss",
            { source: 1234567, title: "Middleware bypass", url: "u" },
          ],
        },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.match(result.blocking[0]?.detail ?? "", /Middleware bypass/);
  });

  it("blocks an unreviewed parent even with no advisory of its own", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        "some-tool": { severity: "high", via: ["postcss"] },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "some-tool");
  });

  it("ignores what is below the bar, so the gate stays worth reading", () => {
    const result = evaluateAudit({
      vulnerabilities: {
        trivial: {
          severity: "moderate",
          via: [{ source: 777, title: "Minor", url: "u" }],
        },
      },
    });

    assert.deepEqual(result.blocking, []);
  });

  it("reports an acceptance that no longer applies instead of keeping it forever", () => {
    // Nothing fails here — but a list that only ever grows stops describing
    // anything, so a fixed advisory is named on the way past.
    const result = evaluateAudit({ vulnerabilities: {} });

    assert.deepEqual(result.blocking, []);
    assert.ok(result.stale.includes("GHSA-qx2v-qp2m-jg93"));
    assert.ok(result.stale.includes("GHSA-f88m-g3jw-g9cj"));
  });
});
