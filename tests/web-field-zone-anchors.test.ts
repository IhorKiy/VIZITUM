import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// The field zone's offline shell depends on its links being plain anchors, and
// nothing said so anywhere (audit F32).
//
// `apps/web/public/sw.js` gates its offline fallback on
// `event.request.mode === "navigate"`. A plain `<a href>` produces a document
// navigation, which is one; a `next/link` click produces a client-side RSC
// fetch, which is not. So converting a field-zone link to `next/link` — an
// ordinary modernisation a lint rule would propose and a reviewer would wave
// through — stops a rep with no signal getting the cached shell on that tap.
//
// **Nothing turns red when that happens.** `web:typecheck`, `lint` and the unit
// suite are indifferent, and `apps/web/e2e/field-offline-shell.spec.ts` stays
// green because it exercises a *reload*, which is `mode: "navigate"` whatever
// the links are made of. This file is the thing that notices.
//
// It is an allowlist rather than a ban, for the reason
// `tests/audit-allowlist.test.ts` uses one: the conversions below already
// exist, and a count would simply be bumped. Naming each one forces a new
// `<Link>` in this zone to be argued in a diff — and makes the ones already
// here visible, which they were not.
//
// **What this file cannot see: programmatic navigation.**
// `components/field-create-fab.tsx` — the create button in the bottom nav —
// navigates with `router.push`/`router.replace` rather than any element this
// scan counts, and costs exactly what a converted link costs: the tap is a
// client-side RSC fetch, so a rep with no signal gets no cached shell from it.
// It is allowed to stand because an anchor cannot do its job. On the task list
// the button adds `?create=1` to the query the rep is *currently* reading, and
// an anchor would have to name a fixed href and so drop their filters — the
// thing they would notice every day, against an offline gap on a button whose
// only job is opening a dialog on a screen the nav beside it already reaches.
//
// The scan stays as it is rather than growing to catch `router.push`: every
// field screen's real navigation is its links, and a regex over router calls
// would flag the server-action redirects that make this zone work. This
// paragraph is the record instead. A second programmatic navigation in this
// zone belongs here too, with what it costs.

const FIELD_ROOT = path.join(
  import.meta.dirname,
  "../apps/web/app/(workspace)/[tenantSlug]/field",
);
const COMPONENTS_ROOT = path.join(
  import.meta.dirname,
  "../apps/web/components",
);

/**
 * Field-zone `next/link` uses that exist today, with what each costs.
 *
 * Every one of these was introduced *after* the audit measured this zone and
 * found the screen bodies entirely on anchors — they arrived with the route
 * planning and field task rebuilds. None is obviously wrong, and none was
 * argued either, which is the point: the trade-off was invisible.
 *
 * A count here is a decision waiting to be made, not a target to reach.
 */
const ALLOWED_CLIENT_LINKS: Record<string, { count: number; note: string }> = {
  "field/tasks/page.tsx": {
    count: 1,
    note: "opens a task sheet on the same route, differing only by query param — a soft navigation either way",
  },
  "field/planning/page.tsx": {
    count: 4,
    note: "week and month stepping inside the planning calendar",
  },
  "field/routes/page.tsx": {
    count: 3,
    note: "route list and editor navigation",
  },
  "components/month-calendar.tsx": {
    count: 2,
    note: "day cells in the planning calendar",
  },
  "components/planning-view-switcher.tsx": {
    count: 3,
    note: "week/month switch on the planning screen",
  },
  "components/task-sticky-bar.tsx": {
    count: 1,
    note: "the field task list's sticky action bar",
  },
  // The persistent chrome, and the one group the audit already recorded as
  // being on the Link side: the bottom nav, the zone switcher and the account
  // link. Rendered on every zone, not only this one.
  "components/app-shell.tsx": {
    count: 3,
    note: "bottom nav, zone switcher and account — app-wide chrome",
  },
  "components/field-menu.tsx": {
    count: 1,
    note: "the field menu drawer, app chrome rather than a screen body",
  },
};

describe("field zone links stay plain anchors", () => {
  const files = [
    ...walk(FIELD_ROOT).map((file) => ({
      key: `field/${path.relative(FIELD_ROOT, file)}`,
      file,
    })),
    ...walk(COMPONENTS_ROOT).map((file) => ({
      key: `components/${path.relative(COMPONENTS_ROOT, file)}`,
      file,
    })),
  ];

  it("finds the field zone", () => {
    // Guards the walk: every assertion below filters this list, so an empty
    // one would make them all vacuously true.
    assert.ok(
      files.length >= 20,
      `expected the walk to find the field screens, got ${files.length}`,
    );
  });

  it("keeps the shared BackLink an anchor", () => {
    // Called out on its own because CLAUDE.md designates it the single
    // "return to the previous screen" affordance for the whole product, so
    // converting this one file would change every screen's back control at
    // once — the single highest-leverage way to lose the offline shell.
    const source = readFileSync(
      path.join(COMPONENTS_ROOT, "back-link.tsx"),
      "utf8",
    );

    assert.match(source, /<a\s/);
    assert.doesNotMatch(source, /<Link\b/);
  });

  it("introduces no client-side link the allowlist does not name", () => {
    const unexpected: string[] = [];

    for (const { key, file } of files) {
      const count = (readFileSync(file, "utf8").match(/<Link\b/g) ?? []).length;
      const allowed = ALLOWED_CLIENT_LINKS[key]?.count ?? 0;

      if (count > allowed) {
        unexpected.push(`${key}: ${count} <Link>, ${allowed} allowed`);
      }
    }

    assert.deepEqual(
      unexpected,
      [],
      "a field-zone link became a next/link — that tap no longer produces a " +
        "document navigation, so sw.js cannot answer it with the cached shell " +
        "when the rep has no signal. Use a plain <a href>, or add an entry to " +
        "ALLOWED_CLIENT_LINKS saying what the conversion costs offline",
    );
  });

  it("keeps the allowlist honest", () => {
    // The other direction. An entry whose links have since been converted back
    // to anchors must be removed, or the allowance silently covers the *next*
    // conversion in that file.
    const stale: string[] = [];

    for (const [key, { count }] of Object.entries(ALLOWED_CLIENT_LINKS)) {
      const match = files.find((entry) => entry.key === key);

      if (!match) {
        stale.push(`${key}: allowlisted but no longer exists`);
        continue;
      }

      const actual = (readFileSync(match.file, "utf8").match(/<Link\b/g) ?? [])
        .length;

      if (actual < count) {
        stale.push(`${key}: allows ${count}, only ${actual} remain`);
      }
    }

    assert.deepEqual(stale, []);
  });
});

function walk(root: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}
