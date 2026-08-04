import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { PENDING_MEDIA_SEED_ARGS } from "./global-setup";

// End-to-end contract for everything a visit leaves on the phone: the typed
// report, and the captures — a photo, a recording — that never reached storage.
// A visit in a dead zone fails at exactly this point, and before this store
// existed the recording was dropped on the floor with an error message.
//
// The guarantee under test is that all three survive the page going away —
// which is what a reload, a killed tab, or an OS reclaiming a backgrounded
// browser all look like from here. It cannot be unit-tested: it lives in
// IndexedDB, and the only honest check is to reload a real browser and see the
// work come back, with its retry still offered where there is one.
//
// Owns its own tenant, seeded by global-setup.ts from the same parameterized
// script field-revisit uses. It cannot share that spec's tenant: both start a
// visit on the seeded stop, `Visit.routeItemId` is unique, and under
// fullyParallel the loser cannot start a visit at all. Re-seeded before each
// test here as well, for the same reason turned inward — every test below starts
// a visit on that one stop, so each needs it handed back — and because a CI
// retry lands in a fresh worker that needs it at "planned" too.
//
// Serial for the same reason, and it has to be stated: `fullyParallel` spreads
// the tests within a file across workers, which would have these racing over one
// planned stop and re-seeding underneath each other.
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

test("a report typed and left behind comes back on the next open", async ({
  page,
}) => {
  // The other half of what the phone keeps, and the half with no coverage until
  // now: the typed report itself. Its rules only work in one order — nothing may
  // be written before the stored draft has been read back, or an empty first
  // render deletes the very report about to be restored — so it is worth a real
  // browser doing a real reload rather than a unit test of the parts.
  const visitUrl = await startVisit(page);

  await page.getByRole("button", { name: "Fill in manually" }).click();
  await page.getByRole("button", { name: "No order", exact: true }).click();
  await page.getByRole("button", { name: "No money" }).click();

  const agreement = page.getByLabel("Agreement for the next visit");
  await agreement.fill("bring the new price list");

  // Past the write debounce, so the reload lands after the record exists rather
  // than testing the flush on unload by accident.
  await page.waitForTimeout(1000);
  await page.reload();

  await expect(
    page.getByText("Restored the report you started on this device."),
  ).toBeVisible();
  // Restored onto the form, not the voice screen, and every field the rep
  // touched is back — including the reason chip, which only exists underneath
  // the "no order" result it was stored with.
  await expect(page.getByLabel("Agreement for the next visit")).toHaveValue(
    "bring the new price list",
  );
  await expect(
    page.getByRole("button", { name: "No order", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "No money" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(page.url()).toBe(visitUrl);
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

// How many records the capture store is holding, read in the browser rather
// than through the app's own module graph. Deliberately a count and not a
// lookup of one key: a capture is one record where the registration never
// landed (CI, with no storage configured at all) and two where it did, and both
// environments have to answer the same question the same way.
//
// A near-copy of the same reader in field-cancel-visit.spec.ts rather than a
// shared import: importing anything out of a spec file executes its top-level
// `test()` calls while this file is being collected, which registers that
// file's tests a second time under this one.
async function pendingMediaCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("vizitum-field");

        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const database = request.result;
          const store = database
            .transaction("pending-media", "readonly")
            .objectStore("pending-media");
          const countRequest = store.count();

          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () =>
            reject(countRequest.error ?? new Error("IndexedDB count failed"));
        };
      }),
  );
}

test("saving the report says it will delete an unsent recording, and only does so once the rep agrees", async ({
  page,
}) => {
  // The one path that destroys a capture the rep cannot make again. Confirming
  // ends the visit, so the screen holding the retry stops rendering and the
  // bytes would sit unreachable — deleting them is right, and doing it without
  // saying so was not: the panel above promises the recording will still be
  // here on the way back, and this is the single thing that makes that untrue.
  // Found on a real iPhone in the offline pass (docs/runbooks/
  // field-offline-iphone-test.md, 2026-08-03), where a rep who dictated a
  // visit, lost it to a dead zone, typed the whole report by hand and saved it
  // was left with an empty `pending-media` store and nothing said.
  await page.addInitScript(STUB_RECORDER);

  const visitUrl = await startVisit(page);

  await page.getByRole("button", { name: "Record voice note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();

  const pending = page.getByRole("region", {
    name: "Recording waiting to be sent",
  });
  await expect(pending).toBeVisible();
  // The panel's own promise now carries the exception to it, not just the half
  // that holds.
  await expect(pending).toContainText("Saving the report deletes it");

  // The manual path is where the rep ends up when the recording cannot be
  // sent, and it is the path that used to discard it in silence.
  await page.getByRole("button", { name: "No order", exact: true }).click();
  await page.getByRole("button", { name: "No money" }).click();
  await page.getByRole("button", { name: "Save report" }).click();

  const prompt = page.getByRole("alert").filter({ hasText: "recording" });
  await expect(prompt).toContainText("still hasn't been sent");
  // Named with the way out, not just the consequence: the recording is only
  // unsendable for as long as there is no signal, and the panel above still
  // holds the retry.
  await expect(prompt).toContainText("Send again");

  // Backing out sends nothing and deletes nothing: the recording is still on
  // the device, with its retry, and the report is still unsaved. The way out
  // is deliberately not labelled "Cancel" — this screen has a "Cancel visit"
  // of its own — so the exact name is part of what this pins.
  await page.getByRole("button", { name: "Don't save yet" }).click();
  await expect(page.getByRole("button", { name: "Save report" })).toBeVisible();
  await expect(pending).toBeVisible();
  expect(await pendingMediaCount(page)).toBeGreaterThan(0);
  expect(page.url()).toBe(visitUrl);

  // Agreeing is what spends it. The report goes through and the rep lands back
  // on today's route — the same ending the silent version had, and the whole
  // difference this test exists for is that they were asked first.
  await page.getByRole("button", { name: "Save report" }).click();
  await page.getByRole("button", { name: "Save and delete" }).click();
  await page.waitForURL("**/field?report=*");

  expect(await pendingMediaCount(page)).toBe(0);
});
