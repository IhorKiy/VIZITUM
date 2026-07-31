import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { EmailConfigService } from "../src/modules/email/email.config";
import { EmailService } from "../src/modules/email/email.service";
import { buildInviteEmail } from "../src/modules/email/invite-email.template";
import { ResendEmailDriver } from "../src/modules/email/resend-email.driver";
import { UsersService } from "../src/modules/users/users.service";

const context = {
  requestId: "request-a",
  tenantId: "tenant-a",
  tenantSlug: "tenant-a",
  userId: "user-a",
  roleCodes: ["tenant_superadmin"],
  permissions: ["admins.invite", "admins.manage"],
};

const EMAIL_ENV_VARS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "APP_BASE_URL",
];

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

describe("invite email template", () => {
  const expiresAt = new Date("2026-07-23T12:00:00.000Z");

  it("renders English copy with the accept link and expiry", () => {
    const email = buildInviteEmail({
      tenantName: "Demo Team",
      acceptUrl: "https://app.example.com/demo-team/invites/accept?token=abc",
      expiresAt,
      language: "en",
      timezone: "Europe/Kyiv",
    });

    assert.equal(email.subject, "You are invited to Demo Team on Vizitum");
    assert.ok(email.text.includes("Demo Team"));
    assert.ok(
      email.text.includes(
        "https://app.example.com/demo-team/invites/accept?token=abc",
      ),
    );
    assert.ok(
      email.html.includes(
        'href="https://app.example.com/demo-team/invites/accept?token=abc"',
      ),
    );
    // Expiry is rendered in the tenant timezone (UTC+3 in July for Kyiv).
    assert.ok(email.text.includes("July 23, 2026"));
  });

  it("renders Ukrainian copy when the tenant language is uk", () => {
    const email = buildInviteEmail({
      tenantName: "Demo Team",
      acceptUrl: "https://app.example.com/demo-team/invites/accept?token=abc",
      expiresAt,
      language: "uk",
      timezone: "Europe/Kyiv",
    });

    assert.equal(email.subject, "Вас запрошено до Demo Team у Vizitum");
    assert.ok(email.text.includes("Вас запрошено приєднатися до Demo Team"));
    assert.ok(
      email.text.includes(
        "https://app.example.com/demo-team/invites/accept?token=abc",
      ),
    );
  });

  it("escapes HTML in the tenant name and falls back to UTC on a bad timezone", () => {
    const email = buildInviteEmail({
      tenantName: '<b>Sneaky & "Co"</b>',
      acceptUrl: "https://app.example.com/x/invites/accept?token=abc",
      expiresAt,
      language: "en",
      timezone: "Not/AZone",
    });

    assert.ok(!email.html.includes("<b>"));
    assert.ok(email.html.includes("&lt;b&gt;Sneaky &amp; &quot;Co&quot;"));
    assert.ok(email.text.includes("July 23, 2026"));
  });
});

describe("resend email driver", () => {
  const outgoing = {
    to: "user@example.com",
    subject: "Subject",
    text: "Text",
    html: "<p>Text</p>",
  };

  it("posts the email to the Resend API with auth and from address", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const driver = new ResendEmailDriver(
      { apiKey: "re_key", from: "Vizitum <no-reply@example.com>" },
      (async (url: string, init: RequestInit) => {
        calls.push({ url, init });

        return new Response(JSON.stringify({ id: "email-1" }), {
          status: 200,
        });
      }) as never,
    );

    await driver.send(outgoing);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(
      (calls[0].init.headers as Record<string, string>).Authorization,
      "Bearer re_key",
    );
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      from: "Vizitum <no-reply@example.com>",
      to: ["user@example.com"],
      subject: "Subject",
      text: "Text",
      html: "<p>Text</p>",
    });
  });

  it("throws with the API status and error message on a non-2xx response", async () => {
    const driver = new ResendEmailDriver(
      { apiKey: "re_key", from: "no-reply@example.com" },
      (async () =>
        new Response(JSON.stringify({ message: "Invalid `from` field" }), {
          status: 422,
        })) as never,
    );

    await assert.rejects(
      () => driver.send(outgoing),
      /Resend API responded with 422: Invalid `from` field/,
    );
  });
});

describe("email service", () => {
  const inviteParams = {
    to: "user@example.com",
    tenantName: "Demo Team",
    tenantSlug: "demo-team",
    language: "en",
    timezone: "Europe/Kyiv",
    token: "invite-token",
    expiresAt: new Date("2026-07-23T12:00:00.000Z"),
    requestId: "request-a",
  };
  const originalEnv: Record<string, string | undefined> = {};

  for (const name of EMAIL_ENV_VARS) {
    originalEnv[name] = process.env[name];
  }

  afterEach(() => {
    setEmailEnv(originalEnv);
  });

  it("skips sending when EMAIL_PROVIDER is unset", async () => {
    setEmailEnv({});
    const service = new EmailService(new EmailConfigService());

    assert.equal(service.isEnabled(), false);
    assert.equal(await service.sendInviteEmail(inviteParams), "skipped");
  });

  it("reports failed instead of throwing when the provider is misconfigured", async () => {
    setEmailEnv({
      EMAIL_PROVIDER: "resend",
      APP_BASE_URL: "https://app.example.com",
      // RESEND_API_KEY and EMAIL_FROM intentionally missing.
    });
    const service = new EmailService(new EmailConfigService());

    assert.equal(service.isEnabled(), true);
    assert.equal(await service.sendInviteEmail(inviteParams), "failed");
  });

  it("sends through the console driver for local development", async () => {
    setEmailEnv({
      EMAIL_PROVIDER: "console",
      APP_BASE_URL: "https://app.example.com",
    });
    const service = new EmailService(new EmailConfigService());

    assert.equal(await service.sendInviteEmail(inviteParams), "sent");
  });
});

describe("invite creation email dispatch", () => {
  function createClient(overrides: Record<string, unknown> = {}) {
    const inviteUpdates: Array<Record<string, unknown>> = [];
    const revocations: Array<Record<string, unknown>> = [];
    const client = {
      user: {
        findUnique: async () => null,
      },
      invite: {
        create: async (query: { data: Record<string, unknown> }) => ({
          id: "invite-1",
          email: query.data.email,
          roleCodes: query.data.roleCodes,
          status: "pending",
          expiresAt: query.data.expiresAt,
        }),
        update: async (query: { data: Record<string, unknown> }) => {
          inviteUpdates.push(query.data);

          return {};
        },
        updateMany: async (query: { where: Record<string, unknown> }) => {
          revocations.push(query.where);

          return { count: 0 };
        },
      },
      platformTenant: {
        findUnique: async () => ({
          name: "Demo Team",
          slug: "demo-team",
          language: "uk",
          timezone: "Europe/Kyiv",
        }),
      },
      ...overrides,
    };

    return { client, inviteUpdates, revocations };
  }

  function createService(client: Record<string, unknown>, emailService: unknown) {
    return new UsersService(
      client as never,
      { revokeUserSessions: async () => {} } as never,
      { recordEvent: async () => {} } as never,
      emailService as never,
    );
  }

  it("persists sent status and withholds the token once the email is on its way", async () => {
    const { client, inviteUpdates } = createClient();
    const sentEmails: Array<Record<string, unknown>> = [];
    const service = createService(client, {
      isEnabled: () => true,
      sendInviteEmail: async (params: Record<string, unknown>) => {
        sentEmails.push(params);

        return "sent";
      },
    });

    const invite = await service.inviteUser(context as never, {
      email: "new.user@example.com",
      roleCodes: ["field_representative"],
    });

    assert.equal(invite.emailStatus, "sent");
    // The plaintext token is a working credential for that address. Once the
    // email carries it, it has no business travelling back through the Next
    // layer, the admin's browser and every log sink in between.
    assert.equal(invite.token, undefined);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "new.user@example.com");
    assert.equal(sentEmails[0].tenantSlug, "demo-team");
    assert.equal(sentEmails[0].language, "uk");
    assert.ok(String(sentEmails[0].token).length > 0);
    assert.equal(inviteUpdates.length, 1);
    assert.equal(inviteUpdates[0].emailStatus, "sent");
    assert.ok(inviteUpdates[0].emailSentAt instanceof Date);
  });

  it("keeps the invite usable when the email attempt fails", async () => {
    const { client, inviteUpdates } = createClient();
    const service = createService(client, {
      isEnabled: () => true,
      sendInviteEmail: async () => "failed",
    });

    const invite = await service.inviteUser(context as never, {
      email: "new.user@example.com",
      roleCodes: ["field_representative"],
    });

    assert.equal(invite.emailStatus, "failed");
    // Nothing was delivered, so the copyable link in the admin UI is the
    // invited person's only way in — the token has to come back here.
    assert.ok((invite.token ?? "").length > 0);
    assert.equal(inviteUpdates.length, 1);
    assert.equal(inviteUpdates[0].emailStatus, "failed");
    assert.equal(inviteUpdates[0].emailSentAt, null);
  });

  it("revokes any earlier pending invite to the same address", async () => {
    const { client, revocations } = createClient();
    const service = createService(client, {
      isEnabled: () => false,
      sendInviteEmail: async () => "skipped",
    });

    await service.inviteUser(context as never, {
      email: "new.user@example.com",
      roleCodes: ["field_representative"],
    });

    // Without this, every invite leaves a 7-day window in which its token can
    // still set a password for that email, so re-inviting someone multiplied
    // the live credentials for one account.
    assert.deepEqual(revocations, [
      {
        tenantId: "tenant-a",
        email: "new.user@example.com",
        status: "pending",
      },
    ]);
  });

  it("skips the tenant lookup and row update when email is disabled", async () => {
    const { client, inviteUpdates } = createClient({
      platformTenant: {
        findUnique: async () => {
          throw new Error("tenant lookup should not run when email is off");
        },
      },
    });
    const service = createService(client, {
      isEnabled: () => false,
      sendInviteEmail: async () => {
        throw new Error("send should not run when email is off");
      },
    });

    const invite = await service.inviteUser(context as never, {
      email: "new.user@example.com",
      roleCodes: ["field_representative"],
    });

    assert.equal(invite.emailStatus, "skipped");
    assert.equal(inviteUpdates.length, 0);
  });
});
