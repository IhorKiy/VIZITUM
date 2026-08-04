import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Dependency-advisory gate.
//
// A bare `npm audit --audit-level=high` cannot be the gate here: three high
// advisories are open and unfixable, so the build would be red from the first
// commit and everyone would learn to ignore it. What matters is not "are there
// advisories" but "are there advisories nobody has looked at" — so every
// accepted one is listed below with its reason, and anything else fails.
//
// The accepted list is deliberately keyed on advisory ids rather than package
// names. Accepting "postcss" wholesale would also accept whatever postcss is
// found to have next year; accepting GHSA-qx2v-qp2m-jg93 accepts exactly the
// thing that was read and judged.
//
// When this fails, the answer is not to add the id. Read the advisory, decide
// whether it reaches this app, and either fix it or record why it does not.

const SEVERITIES_THAT_BLOCK = new Set(["high", "critical"]);

// Empty as of 2026-08-03, and that is the healthy state: every advisory this
// list used to carry (three in postcss, one in sharp) now has a fix, taken in
// the same change that emptied this. Add an entry only for an advisory that
// genuinely cannot be fixed, with the reasoning, and delete it the moment a
// fix lands — a stale acceptance silently waives a package that no longer
// needs waiving.
const ACCEPTED_ADVISORIES = [];

// Packages that appear in the report solely because they depend on an accepted
// one. They are accepted only while that stays true: npm reports a parent's own
// advisories as objects in `via`, so an object there means this package has
// grown a problem of its own and must be read rather than waved through.
//
// Empty since the postcss advisories were fixed: `next` was here only as their
// parent, and leaving it would have waved through whatever next inherits next.
const ACCEPTED_PARENTS = [];

// The two lists are parameters with the real ones as defaults, not closed-over
// constants: the rules this function encodes outlive whatever happens to be
// accepted today, and tests that had to name real advisory ids broke the moment
// a fix landed and the list emptied — turning a green suite into a reason not to
// clean the list up.
export function evaluateAudit(
  report,
  { acceptedAdvisories = ACCEPTED_ADVISORIES, acceptedParents = ACCEPTED_PARENTS } = {},
) {
  const acceptedIds = new Set(acceptedAdvisories.map((entry) => entry.id));
  const blocking = [];
  const accepted = [];

  for (const [name, vulnerability] of Object.entries(
    report.vulnerabilities ?? {},
  )) {
    if (!SEVERITIES_THAT_BLOCK.has(vulnerability.severity)) {
      continue;
    }

    const via = vulnerability.via ?? [];
    const ownAdvisories = via.filter((entry) => typeof entry === "object");

    if (ownAdvisories.length === 0) {
      // Reported only as the parent of something else.
      if (acceptedParents.includes(name)) {
        accepted.push({
          package: name,
          reason: "parent of an accepted advisory",
        });
      } else {
        blocking.push({
          package: name,
          severity: vulnerability.severity,
          detail: `depends on ${via.join(", ") || "an unnamed advisory"}`,
        });
      }
      continue;
    }

    for (const advisory of ownAdvisories) {
      if (acceptedIds.has(advisory.source)) {
        accepted.push({ package: name, reason: advisory.url });
      } else {
        blocking.push({
          package: name,
          severity: vulnerability.severity,
          detail: `${advisory.title ?? "advisory"} (${advisory.url ?? advisory.source})`,
        });
      }
    }
  }

  // An accepted entry that no longer appears means the advisory was fixed or
  // the dependency dropped. Not a failure — but the list should not grow stale
  // silently, so it is reported.
  const seenIds = new Set(
    Object.values(report.vulnerabilities ?? {})
      .flatMap((vulnerability) => vulnerability.via ?? [])
      .filter((entry) => typeof entry === "object")
      .map((entry) => entry.source),
  );
  const stale = acceptedAdvisories
    .filter((entry) => !seenIds.has(entry.id))
    .map((entry) => entry.reference);

  return { blocking, accepted, stale };
}

function runAudit() {
  // `npm audit` exits non-zero whenever it finds anything, so the exit code is
  // not the signal — the JSON is. A genuine failure to run shows up as
  // unparseable output instead.
  let output;

  try {
    output = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    output = error.stdout;
  }

  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `npm audit did not return JSON. Raw output:\n${(output ?? "").slice(0, 2000)}`,
    );
  }
}

function main() {
  const { blocking, accepted, stale } = evaluateAudit(runAudit());

  for (const entry of accepted) {
    console.log(`accepted: ${entry.package} — ${entry.reason}`);
  }

  for (const reference of stale) {
    console.log(
      `stale acceptance: ${reference} no longer appears — remove it from ACCEPTED_ADVISORIES.`,
    );
  }

  if (blocking.length === 0) {
    console.log(
      `\nOK: ${accepted.length} accepted advisory reference(s), nothing unreviewed.`,
    );
    return;
  }

  console.error("\nUnreviewed dependency advisories:\n");

  for (const entry of blocking) {
    console.error(`  ${entry.package} [${entry.severity}] — ${entry.detail}`);
  }

  console.error(
    "\nRead each one and decide whether it reaches this app. If it does not,",
  );
  console.error(
    "add it to ACCEPTED_ADVISORIES in scripts/audit-check.mjs with the reason.",
  );

  process.exitCode = 1;
}

// Importable for the test, executable for CI.
const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main();
}
