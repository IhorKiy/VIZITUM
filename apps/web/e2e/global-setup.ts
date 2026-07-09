import { execFileSync } from "node:child_process";
import path from "node:path";

// The platform-auth specs sign in as the seeded platform owner. The seed is
// an upsert (scripts/seed-platform-owner.mjs), so re-running is safe against
// a shared local database; credentials default to owner@platform.local /
// Owner12345! whenever DATABASE_URL points at localhost.
export default function globalSetup(): void {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync("node", ["scripts/seed-platform-owner.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
