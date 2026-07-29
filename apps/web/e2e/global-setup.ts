import { execFileSync } from "node:child_process";
import path from "node:path";

// Seeds every fixture the specs sign in with, once per run and before any
// worker starts.
//
// - scripts/seed-platform-owner.mjs: platform owner for the platform-auth
//   specs (owner@platform.local / Owner12345! against a localhost database).
// - scripts/seed-e2e-field-revisit.mjs: dedicated tenant + field rep for the
//   field-revisit, notice-compact and field-announcements specs. It carries
//   both the route/visit state field-revisit drives and the pair of
//   announcements (one unread, one acknowledged) field-announcements reads.
//   field-revisit re-seeds it in its own beforeAll (it mutates that state and
//   a CI retry needs a clean start); it runs here too so specs that only sign
//   in with the rep, or read state they never touch, don't depend on another
//   file's hooks. Keep destructive re-seeds out of the OTHER files' beforeAll:
//   under fullyParallel they would wipe the state field-revisit is mid-way
//   through asserting. The same rule bounds what those files may do — read the
//   seeded state, never mutate it, since field-revisit's re-seed can land at
//   any point in their run.
//
// Both seeds are idempotent upserts, so re-running against the shared local
// database is safe.
export default function globalSetup(): void {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  for (const script of [
    "scripts/seed-platform-owner.mjs",
    "scripts/seed-e2e-field-revisit.mjs",
  ]) {
    execFileSync("node", [script], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }
}
