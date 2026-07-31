import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { EmailConfigService } from "../src/modules/email/email.config";
import { EmailService } from "../src/modules/email/email.service";
import { buildPasswordResetEmail } from "../src/modules/email/password-reset-email.template";

const EMAIL_ENV_VARS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "APP_BASE_URL",
];

const originalEnv = Object.fromEntries(
  EMAIL_ENV_VARS.map((name) => [name, process.env[name]]),
);

function setEmailEnv(values: Record<string, string | undefined>) {
  for (const name of EMAIL_ENV_VARS) {
    const value = values[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

describe("password reset email template", () => {
  const expiresAt = new Date("2026-07-31T12:00:00.000Z");
  const resetUrl =
    "https://app.example.com/demo-team/password/reset?token=abc123";

  it("renders English copy with the reset link and expiry", () => {
    const email = buildPasswordResetEmail({
      tenantName: "Demo Team",
      resetUrl,
      expiresAt,
      language: "en",
      timezone: "Europe/Kyiv",
    });

    assert.equal(email.subject, "Reset your Demo Team password on Vizitum");
    assert.ok(email.text.includes(resetUrl));
    assert.ok(email.html.includes(`href="${resetUrl}"`));
    // Rendered in the tenant timezone (UTC+3 in July for Kyiv).
    assert.ok(email.text.includes("July 31, 2026"));
    // The line that matters most on this particular email: an unsolicited
    // recipient has to be told outright that nothing happens if they ignore it.
    assert.ok(email.text.includes("stays unchanged"));
  });

  it("renders Ukrainian copy when the tenant language is uk", () => {
    const email = buildPasswordResetEmail({
      tenantName: "Demo Team",
      resetUrl,
      expiresAt,
      language: "uk",
      timezone: "Europe/Kyiv",
    });

    assert.ok(email.subject.includes("Відновлення паролю"));
    assert.ok(email.text.includes(resetUrl));
    assert.ok(email.text.includes("незмінним"));
  });

  it("falls back to English for an unsupported tenant language", () => {
    const email = buildPasswordResetEmail({
      tenantName: "Demo Team",
      resetUrl,
      expiresAt,
      language: "pl",
      timezone: "Europe/Kyiv",
    });

    assert.equal(email.subject, "Reset your Demo Team password on Vizitum");
  });

  it("falls back to UTC when the tenant timezone is unusable", () => {
    const email = buildPasswordResetEmail({
      tenantName: "Demo Team",
      resetUrl,
      expiresAt,
      language: "en",
      timezone: "Not/AZone",
    });

    assert.ok(email.text.includes("July 31, 2026"));
  });

  it("escapes a tenant name that contains markup", () => {
    const email = buildPasswordResetEmail({
      tenantName: '<script>alert("x")</script>',
      resetUrl,
      expiresAt,
      language: "en",
      timezone: "UTC",
    });

    assert.ok(!email.html.includes("<script>"));
    assert.ok(email.html.includes("&lt;script&gt;"));
  });
});

describe("password reset email delivery", () => {
  afterEach(() => {
    setEmailEnv(originalEnv);
  });

  it("is skipped when email sending is off", async () => {
    setEmailEnv({ EMAIL_PROVIDER: "off" });
    const service = new EmailService(new EmailConfigService());

    const result = await service.sendPasswordResetEmail({
      to: "rep@demo-team.local",
      tenantName: "Demo Team",
      tenantSlug: "demo-team",
      language: "en",
      timezone: "UTC",
      token: "abc123",
      expiresAt: new Date(),
    });

    assert.equal(result, "skipped");
  });

  it("builds the reset URL against APP_BASE_URL and encodes the token", async () => {
    setEmailEnv({
      EMAIL_PROVIDER: "console",
      APP_BASE_URL: "https://app.example.com/",
    });
    const logged: string[] = [];
    const service = new EmailService(new EmailConfigService());
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      logged.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const result = await service.sendPasswordResetEmail({
        to: "rep@demo-team.local",
        tenantName: "Demo Team",
        tenantSlug: "demo-team",
        language: "en",
        timezone: "UTC",
        // Contains a character that must survive as %2B, not as a space.
        token: "abc+123",
        expiresAt: new Date(),
      });

      assert.equal(result, "sent");
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = logged.join("");
    // Trailing slash trimmed, token percent-encoded, and the path is the reset
    // screen rather than the invite one.
    assert.ok(
      output.includes(
        "https://app.example.com/demo-team/password/reset?token=abc%2B123",
      ),
      output,
    );
  });

  it("reports failed rather than throwing when the provider is unusable", async () => {
    setEmailEnv({
      EMAIL_PROVIDER: "resend",
      APP_BASE_URL: "https://app.example.com",
      // RESEND_API_KEY deliberately unset: resolving the driver throws.
    });
    const service = new EmailService(new EmailConfigService());

    const result = await service.sendPasswordResetEmail({
      to: "rep@demo-team.local",
      tenantName: "Demo Team",
      tenantSlug: "demo-team",
      language: "en",
      timezone: "UTC",
      token: "abc123",
      expiresAt: new Date(),
    });

    assert.equal(result, "failed");
  });
});
