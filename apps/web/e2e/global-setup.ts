import { execFileSync } from "node:child_process";
import path from "node:path";

// Seeds every fixture the specs sign in with, once per run and before any
// worker starts. Seeding must live here, not in per-spec beforeAll hooks:
// the field seed destructively resets route/visit state, and with
// fullyParallel a beforeAll re-seed in one spec file could wipe the state
// another file is mid-way through asserting.
//
// - scripts/seed-platform-owner.mjs: platform owner for the platform-auth
//   specs (owner@platform.local / Owner12345! against a localhost database).
// - scripts/seed-e2e-field-revisit.mjs: dedicated tenant + field rep for the
//   field-revisit and notice-compact specs; resets route-item status and
//   leftover visits so field-revisit always starts from "planned".
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
