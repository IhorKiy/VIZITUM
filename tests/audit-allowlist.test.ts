import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateAudit } from "../scripts/audit-check.mjs";

// The gate that decides whether a dependency advisory blocks CI. A bare
// `npm audit --audit-level=high` cannot do the job: advisories with no fix do
// turn up and sit for weeks, and while one is open a bare audit is red on
// every commit, so everyone learns to ignore it. This one asks the useful
// question instead — is there an advisory nobody has looked at — which only
// works if "looked at" is pinned narrowly. These cases are what stop it
// drifting back into a rubber stamp.
//
// The accepted lists are passed in rather than read from the script's own
// constants. Pointing at whatever happened to be accepted that week made the
// suite dependent on the app having open advisories: when next@16.3.0 closed
// the last four on 2026-08-04 and the real list went empty, three tests here
// failed for having nothing left to point at. What is under test is the
// matching, so the fixtures are the matching's inputs.
const ACCEPTED = [
  {
    id: 1117015,
    package: "postcss",
    reference: "GHSA-qx2v-qp2m-jg93",
    reason: "Read and judged not to reach this app.",
  },
  {
    id: 1124066,
    package: "sharp",
    reference: "GHSA-f88m-g3jw-g9cj",
    reason: "Read and judged not to reach this app.",
  },
];
const PARENTS = ["next"];

describe("dependency advisory gate", () => {
  it("passes the advisories that were read and judged", () => {
    const result = evaluateAudit(
      {
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
      },
      ACCEPTED,
      PARENTS,
    );

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks an advisory nobody has read, in a package that is otherwise accepted", () => {
    // The case a package-name allowlist would wave through: postcss is on the
    // list, but this is a different finding than the ones that were judged.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          postcss: {
            severity: "high",
            via: [
              { source: 1117015, url: "known" },
              { source: 9999999, title: "Something new", url: "unread" },
            ],
          },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "postcss");
    assert.match(result.blocking[0]?.detail ?? "", /Something new/);
  });

  it("blocks a package that has never been reviewed", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          lodash: {
            severity: "critical",
            via: [{ source: 4242, title: "Prototype pollution", url: "u" }],
          },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "lodash");
  });

  it("accepts a parent listed only for what it depends on", () => {
    // `next` is reported because postcss and sharp are under it. While its
    // `via` is nothing but package names, it carries no advisory of its own.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          next: { severity: "high", via: ["postcss", "sharp"] },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks that same parent the moment it has a finding of its own", () => {
    // This is the tripwire the plan describes in prose: an object in `via`
    // rather than a string means next itself is affected, which is a decision
    // to make rather than a transitive fact to wave through.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          next: {
            severity: "high",
            via: [
              "postcss",
              { source: 1234567, title: "Middleware bypass", url: "u" },
            ],
          },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.equal(result.blocking.length, 1);
    assert.match(result.blocking[0]?.detail ?? "", /Middleware bypass/);
  });

  it("blocks an unreviewed parent even with no advisory of its own", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "some-tool": { severity: "high", via: ["postcss"] },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "some-tool");
  });

  it("ignores what is below the bar, so the gate stays worth reading", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          trivial: {
            severity: "moderate",
            via: [{ source: 777, title: "Minor", url: "u" }],
          },
        },
      },
      ACCEPTED,
      PARENTS,
    );

    assert.deepEqual(result.blocking, []);
  });

  it("reports an acceptance that no longer applies instead of keeping it forever", () => {
    // Nothing fails here — but a list that only ever grows stops describing
    // anything, so a fixed advisory is named on the way past. This is what
    // emptied the real list on 2026-08-04.
    const result = evaluateAudit({ vulnerabilities: {} }, ACCEPTED, PARENTS);

    assert.deepEqual(result.blocking, []);
    assert.ok(result.stale.includes("GHSA-qx2v-qp2m-jg93"));
    assert.ok(result.stale.includes("GHSA-f88m-g3jw-g9cj"));
  });

  it("falls back to the real lists when none are passed", () => {
    // The defaults are what CI actually runs on, so something has to hold them
    // to the same rules rather than only ever exercising fixtures. An empty
    // accepted list means an unfixed advisory blocks no matter its package.
    const result = evaluateAudit({
      vulnerabilities: {
        postcss: {
          severity: "high",
          via: [{ source: 1117015, title: "Formerly accepted", url: "u" }],
        },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "postcss");
  });
});
