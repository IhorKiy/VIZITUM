import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { PENDING_MEDIA_SEED_ARGS } from "./global-setup";

// End-to-end contract for the one thing a rep cannot get back: bytes they
// captured that never reached storage. A visit in a dead zone fails at exactly
// this point, and before the pending-media store existed the recording (or
// photo) was dropped on the floor with an error message.
//
// The guarantee under test is that the bytes survive the page going away —
// which is what a reload, a killed tab, or an OS reclaiming a backgrounded
// browser all look like from here. It cannot be unit-tested: it lives in
// IndexedDB, and the only honest check is to reload a real browser and see the
// capture come back with its retry still offered.
//
// Owns its own tenant, seeded by global-setup.ts from the same parameterized
// script field-revisit uses. It cannot share that spec's tenant: both start a
// visit on the seeded stop, `Visit.routeItemId` is unique, and under
// fullyParallel the loser cannot start a visit at all. Re-seeded before each
// test here as well, for the same reason turned inward — both tests below start
// a visit on that one stop, so each needs it handed back — and because a CI
// retry lands in a fresh worker that needs it at "planned" too.
//
// Serial for the same reason, and it has to be stated: `fullyParallel` spreads
// the tests within a file across workers, which would have these two racing over
// one planned stop and re-seeding underneath each other.
//
// Every PUT is aborted so the upload cannot succeed. That covers both
// environments deliberately: CI has no S3 configuration at all, so the
// registration itself fails there, while a developer with storage configured
// gets as far as the upload. Both paths must end with the bytes held and a
// retry offered, and the assertions below are the same either way.

const TENANT_SLUG = "e2e-field-media";
const REP_EMAIL = "rep@e2e-field-media.local";
const REP_PASSWORD = "E2eField12345!";
const LOCATION_NAME = "E2E Media Market";
const PHOTO_NAME = "shelf-problem.png";

test.describe.configure({ mode: "serial" });

// The audio test's microphone, stubbed at the browser API rather than supplied
// by the browser. Chromium's own fake device was the first choice and does not
// work here: `--use-fake-device-for-media-stream` enumerates fake inputs, but
// `getUserMedia` then never settles for audio *or* video under headless Chromium
// on macOS, which is where this suite is run by hand. A test that hangs for
// thirty seconds on every developer's machine buys less than it costs.
//
// What is faked is the platform, not the code under test. `MediaRecorder` hands
// over a real `Blob` on a real asynchronous "stop", and everything the spec is
// actually about runs untouched: the blob becoming an `ArrayBuffer`, the write
// landing before any network call, the record coming back after a reload as a
// blob an object URL still resolves. What it cannot catch is a codec or mime-type
// problem in the real recorder — that needs a device, and a device needs an
// environment that has one.
const STUB_RECORDER = `
  navigator.mediaDevices.getUserMedia = async () => ({
    getTracks: () => [{ stop() {} }],
  });

  window.MediaRecorder = class {
    static isTypeSupported() { return true; }

    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options?.mimeType ?? "audio/webm";
      this.state = "inactive";
      this.handlers = {};
    }

    addEventListener(type, handler) {
      (this.handlers[type] ??= []).push(handler);
    }

    dispatch(type, event) {
      for (const handler of this.handlers[type] ?? []) handler(event);
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      // Deferred deliberately: the real recorder assembles the blob after
      // stop() returns, and the form has a state of its own for that gap.
      setTimeout(() => {
        this.dispatch("dataavailable", {
          data: new Blob([new Uint8Array(4096).fill(3)], { type: this.mimeType }),
        });
        this.dispatch("stop", {});
      }, 0);
    }
  };
`;

test.beforeEach(() => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");

  execFileSync(
    "node",
    ["scripts/seed-e2e-field-revisit.mjs", ...PENDING_MEDIA_SEED_ARGS],
    { cwd: repoRoot, stdio: "inherit" },
  );
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`/${TENANT_SLUG}/login`);
  await page.getByLabel("Email").fill(REP_EMAIL);
  await page.getByLabel("Password").fill(REP_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`**/${TENANT_SLUG}/field`);
}

// Reaches the report form of a fresh visit on the seeded stop, with every PUT
// aborted for the life of the page — the upload is the step that fails in a
// basement, and it has to stay failed across the reload too.
async function startVisit(page: Page): Promise<string> {
  await page.route("**/*", async (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );

  await signIn(page);

  await page
    .getByRole("link", { name: `View ${LOCATION_NAME}` })
    .first()
    .click();
  await page.waitForURL("**/field/locations/**");
  await page.getByRole("button", { name: "Start visit", exact: true }).click();
  await page.waitForURL("**/field/visits/**");

  return page.url();
}

test("a photo that never reached storage survives the page going away", async ({
  page,
}) => {
  const visitUrl = await startVisit(page);

  // The manual form is the fallback path and has to be reachable without the
  // microphone ever being touched.
  await page.getByRole("button", { name: "Fill in manually" }).click();
  await page.getByRole("button", { name: /^Problem/ }).click();

  await page.getByLabel(/Add a photo|Uploading/).setInputFiles({
    name: PHOTO_NAME,
    mimeType: "image/png",
    buffer: Buffer.alloc(2048, 7),
  });

  // The failure is reported as something the rep can act on, not as a loss.
  const pending = page.getByRole("region", {
    name: "Photo waiting to be sent",
  });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText(PHOTO_NAME);
  await expect(pending).toContainText("Saved on this device");
  await expect(
    pending.getByRole("button", { name: "Send again" }),
  ).toBeVisible();

  // The page going away is the case this whole store exists for.
  await page.reload();

  const restored = page.getByRole("region", {
    name: "Photo waiting to be sent",
  });
  await expect(restored).toBeVisible();
  await expect(restored).toContainText(PHOTO_NAME);
  await expect(
    restored.getByRole("button", { name: "Send again" }),
  ).toBeVisible();

  // Restoring must land the rep on the form rather than the voice screen,
  // which would hide the retry behind a mic button — and the report must stay
  // fillable regardless, since manual confirmation is always available.
  await expect(page.getByRole("button", { name: "Save report" })).toBeVisible();
  expect(page.url()).toBe(visitUrl);

  // Discarding is the rep's own choice and must actually forget the bytes, so
  // a later reload does not resurrect what they dismissed.
  await restored.getByRole("button", { name: "Delete photo" }).click();
  await expect(restored).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Photo waiting to be sent" }),
  ).toBeHidden();
});

test("a recording that never reached storage survives the page going away", async ({
  page,
}) => {
  // The case the photo cannot stand in for. A photo can be taken again; the
  // conversation this recording is of cannot be had again, which is the whole
  // reason the bytes are written before any network call — and the audio branch
  // of that store has its own decisions behind it (`ArrayBuffer` rather than
  // `Blob`, the mime type carried beside the bytes) that nothing else covers.
  await page.addInitScript(STUB_RECORDER);

  const visitUrl = await startVisit(page);

  await page.getByRole("button", { name: "Record voice note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();

  const pending = page.getByRole("region", {
    name: "Recording waiting to be sent",
  });
  await expect(pending).toBeVisible();
  await expect(pending).toContainText("Saved on this device");
  await expect(
    pending.getByRole("button", { name: "Send again" }),
  ).toBeVisible();
  // The rep gets to hear what is waiting before deciding to send it again.
  await expect(pending.locator("audio")).toBeVisible();

  await page.reload();

  const restored = page.getByRole("region", {
    name: "Recording waiting to be sent",
  });
  await expect(restored).toBeVisible();
  await expect(
    restored.getByRole("button", { name: "Send again" }),
  ).toBeVisible();
  // The player comes back too, which is the observable end of the round trip:
  // the bytes survived as bytes, and an object URL over them still resolves.
  await expect(restored.locator("audio")).toBeVisible();

  // Restoring lands on the form rather than the voice screen, which would hide
  // the retry behind a mic button, and the manual path stays available — the
  // recording failing must never be what blocks the report.
  await expect(page.getByRole("button", { name: "Save report" })).toBeVisible();
  expect(page.url()).toBe(visitUrl);

  await restored.getByRole("button", { name: "Delete recording" }).click();
  await expect(restored).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Recording waiting to be sent" }),
  ).toBeHidden();
});
