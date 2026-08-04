import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateAudit } from "../scripts/audit-check.mjs";

// The gate that decides whether a dependency advisory blocks CI. A bare
// `npm audit --audit-level=high` cannot do the job: whenever a high advisory is
// open and unfixable it would be red on every commit and everyone would learn
// to ignore it. This one asks the useful question instead — is there an
// advisory nobody has looked at — which only works if "looked at" is pinned
// narrowly. These cases are what stop it drifting back into a rubber stamp.
//
// Every case injects its own accepted list rather than naming whatever the
// shipped one happens to hold. That list is meant to empty out as fixes land,
// and tests written against its real contents failed the moment it did — which
// made a green suite an argument against cleaning it up, the exact opposite of
// what this gate is for.
const ACCEPTED = [
  {
    id: 1001,
    package: "acme-css",
    reference: "GHSA-fixture-read-and-judged",
    reason: "Fixture: read, judged not to reach this app.",
  },
  {
    id: 1002,
    package: "acme-image",
    reference: "GHSA-fixture-also-judged",
    reason: "Fixture: second accepted advisory, in a different package.",
  },
];

const PARENTS = ["acme-framework"];

const lists = { acceptedAdvisories: ACCEPTED, acceptedParents: PARENTS };

describe("dependency advisory gate", () => {
  it("passes the advisories that were read and judged", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "acme-css": {
            severity: "high",
            via: [{ source: 1001, url: "https://example.test/GHSA-fixture-1" }],
          },
        },
      },
      lists,
    );

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks an advisory nobody has read, in a package that is otherwise accepted", () => {
    // The case a package-name allowlist would wave through: acme-css is on the
    // list, but this is a different finding than the one that was judged.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "acme-css": {
            severity: "high",
            via: [
              { source: 1001, url: "known" },
              { source: 9999999, title: "Something new", url: "unread" },
            ],
          },
        },
      },
      lists,
    );

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "acme-css");
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
      lists,
    );

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "lodash");
  });

  it("accepts a parent listed only for what it depends on", () => {
    // A framework is reported because accepted packages sit under it. While its
    // `via` is nothing but package names, it carries no advisory of its own.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "acme-framework": {
            severity: "high",
            via: ["acme-css", "acme-image"],
          },
        },
      },
      lists,
    );

    assert.deepEqual(result.blocking, []);
    assert.equal(result.accepted.length, 1);
  });

  it("blocks that same parent the moment it has a finding of its own", () => {
    // This is the tripwire the plan describes in prose: an object in `via`
    // rather than a string means the parent itself is affected, which is a
    // decision to make rather than a transitive fact to wave through.
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "acme-framework": {
            severity: "high",
            via: [
              "acme-css",
              { source: 1234567, title: "Middleware bypass", url: "u" },
            ],
          },
        },
      },
      lists,
    );

    assert.equal(result.blocking.length, 1);
    assert.match(result.blocking[0]?.detail ?? "", /Middleware bypass/);
  });

  it("blocks an unreviewed parent even with no advisory of its own", () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          "some-tool": { severity: "high", via: ["acme-css"] },
        },
      },
      lists,
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
      lists,
    );

    assert.deepEqual(result.blocking, []);
  });

  it("reports an acceptance that no longer applies instead of keeping it forever", () => {
    // Nothing fails here — but a list that only ever grows stops describing
    // anything, so a fixed advisory is named on the way past. This is what
    // emptied the shipped list once the postcss and sharp advisories were
    // fixable.
    const result = evaluateAudit({ vulnerabilities: {} }, lists);

    assert.deepEqual(result.blocking, []);
    assert.ok(result.stale.includes("GHSA-fixture-read-and-judged"));
    assert.ok(result.stale.includes("GHSA-fixture-also-judged"));
  });

  it("waves nothing through when the shipped lists are consulted", () => {
    // The defaults, not a fixture: with nothing accepted today, any high
    // advisory in any package must block. If someone adds an entry, this stays
    // green — it pins the wiring, not the contents.
    const result = evaluateAudit({
      vulnerabilities: {
        "acme-css": {
          severity: "high",
          via: [{ source: 1001, title: "Fixture advisory", url: "u" }],
        },
      },
    });

    assert.equal(result.blocking.length, 1);
    assert.equal(result.blocking[0]?.package, "acme-css");
  });
});
