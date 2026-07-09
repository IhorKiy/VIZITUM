import path from "node:path";

import { defineConfig } from "@playwright/test";

// E2E harness for the Next.js app. Boots the real stack — the NestJS API
// (root workspace) and `next dev` — against the shared local Postgres, so
// Server Actions, cookies and redirects are exercised exactly as a browser
// sees them. Ports are E2E-specific (web 3100 / API 4100) so runs never
// collide with the dev servers on 3000/4000 or the worktree slots on
// 300N/400N; override with E2E_WEB_PORT / E2E_API_PORT if either is taken.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // ts-node, not tsx: NestJS DI needs design:paramtypes metadata that
      // esbuild never emits (see CLAUDE.md). DATABASE_URL comes from the
      // root .env locally (dotenv never overrides the PORT set here) or
      // from the environment in CI.
      command: "node --require ts-node/register src/main.ts",
      cwd: REPO_ROOT,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}/platform/login`,
      env: { API_BASE_URL: `http://127.0.0.1:${API_PORT}/api` },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
