import { execFileSync } from "node:child_process";
import path from "node:path";

// Seeds every fixture the specs sign in with, once per run and before any
// worker starts.
//
// - scripts/seed-platform-owner.mjs, twice. The console now requires a second
//   factor, and enrolment happens once per account — so the specs that merely
//   need to be signed in get an owner pre-enrolled against a known TOTP
//   secret (they act as the authenticator app), while the spec that exercises
//   the enrolment journey itself gets its own, deliberately unenrolled
//   account. Sharing one would make the outcome depend on which spec reached
//   it first, and the suite runs fullyParallel — the same reason the field
//   specs each get their own tenant below.
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
// - the same script again, for a SECOND tenant used by field-pending-media, a
//   THIRD used by field-cancel-visit, and a FOURTH used by
//   field-offline-visit-start. Two specs that start visits cannot share one
//   tenant: `Visit.routeItemId` is unique, so whichever of them reaches the
//   planned stop second cannot start a visit at all — which is exactly how
//   they failed together while passing alone.
//
// All seeds are idempotent upserts, so re-running against the shared local
// database is safe.
export const PENDING_MEDIA_SEED_ARGS = [
  "e2e-field-media",
  "Vizitum E2E Field Media",
  "E2E Media Market",
];

export const CANCEL_VISIT_SEED_ARGS = [
  "e2e-field-cancel",
  "Vizitum E2E Field Cancel",
  "E2E Cancel Market",
];

export const OFFLINE_VISIT_START_SEED_ARGS = [
  "e2e-field-offline-start",
  "Vizitum E2E Offline Start",
  "E2E Offline Start Market",
];

// A FIFTH, for login-signed-in. Its own for the usual parallel reason plus one
// of its own: the spec is about what a *live session* does to a login screen,
// so it needs a rep nothing else is signing in as at the same moment.
export const LOGIN_REDIRECT_SEED_ARGS = [
  "e2e-login-redirect",
  "Vizitum E2E Login Redirect",
  "E2E Login Redirect Market",
];

// Test-only, and only ever applied to a localhost database by the seed
// script's own guard. The specs generate codes from it exactly as an
// authenticator app would.
export const E2E_PLATFORM_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export const E2E_PLATFORM_OWNER_PASSWORD = "Owner12345!";

// One account per spec that completes a sign-in. They cannot share one:
// entering the password issues a challenge and drops any outstanding one for
// that account, so under fullyParallel two specs mid-login would knock each
// other's challenge out. Same reason the field specs each get their own
// tenant below.
export const E2E_PLATFORM_SESSION_EMAILS = [
  "session-owner-1@platform.local",
  "session-owner-2@platform.local",
  "session-owner-3@platform.local",
  "session-owner-4@platform.local",
] as const;

// The account the enrolment spec drives, kept apart from the rest so nothing
// races it for the one-time enrolment.
export const E2E_PLATFORM_ENROLL_EMAIL = "enroll-owner@platform.local";
export const E2E_PLATFORM_ENROLL_PASSWORD = E2E_PLATFORM_OWNER_PASSWORD;

export default function globalSetup(): void {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  const seeds: { script: string[]; env?: Record<string, string> }[] = [
    {
      script: ["scripts/seed-platform-owner.mjs"],
      env: { PLATFORM_OWNER_TOTP_SECRET: E2E_PLATFORM_TOTP_SECRET },
    },
    ...E2E_PLATFORM_SESSION_EMAILS.map((email, index) => ({
      script: ["scripts/seed-platform-owner.mjs"],
      env: {
        PLATFORM_OWNER_EMAIL: email,
        PLATFORM_OWNER_PASSWORD: E2E_PLATFORM_OWNER_PASSWORD,
        PLATFORM_OWNER_NAME: `Vizitum E2E Session Owner ${index + 1}`,
        PLATFORM_OWNER_TOTP_SECRET: E2E_PLATFORM_TOTP_SECRET,
      },
    })),
    {
      script: ["scripts/seed-platform-owner.mjs"],
      env: {
        PLATFORM_OWNER_EMAIL: E2E_PLATFORM_ENROLL_EMAIL,
        PLATFORM_OWNER_PASSWORD: E2E_PLATFORM_ENROLL_PASSWORD,
        PLATFORM_OWNER_NAME: "Vizitum E2E Enrolment Owner",
        // No TOTP secret: this account must start unenrolled.
      },
    },
    { script: ["scripts/seed-e2e-field-revisit.mjs"] },
    {
      script: [
        "scripts/seed-e2e-field-revisit.mjs",
        ...PENDING_MEDIA_SEED_ARGS,
      ],
    },
    {
      script: ["scripts/seed-e2e-field-revisit.mjs", ...CANCEL_VISIT_SEED_ARGS],
    },
    {
      script: [
        "scripts/seed-e2e-field-revisit.mjs",
        ...OFFLINE_VISIT_START_SEED_ARGS,
      ],
    },
    {
      script: [
        "scripts/seed-e2e-field-revisit.mjs",
        ...LOGIN_REDIRECT_SEED_ARGS,
      ],
    },
  ];

  for (const { script, env } of seeds) {
    execFileSync("node", script, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
  }
}
