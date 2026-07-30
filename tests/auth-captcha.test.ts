import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { TurnstileService } from "../src/modules/auth/turnstile.service";
import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { RolesService } from "../src/modules/roles/roles.service";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function assertCaptchaInvalid(error: unknown): boolean {
  assert.ok(error instanceof BadRequestException);
  assert.equal(
    (error.getResponse() as { code?: string }).code,
    "CAPTCHA_INVALID",
  );
  return true;
}

describe("turnstile verification", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;

    if (originalSecret === undefined) {
      delete process.env.TURNSTILE_SECRET_KEY;
    } else {
      process.env.TURNSTILE_SECRET_KEY = originalSecret;
    }
  });

  it("is a no-op when TURNSTILE_SECRET_KEY is unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    stubFetch(async () => {
      throw new Error("siteverify must not be called when disabled");
    });

    const service = new TurnstileService();

    assert.equal(service.isEnabled(), false);
    await service.assertValidToken(undefined);
    await service.assertValidToken("anything");
  });

  it("rejects a missing or malformed token without calling Cloudflare", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    stubFetch(async () => {
      throw new Error("siteverify must not be called for a missing token");
    });

    const service = new TurnstileService();

    assert.equal(service.isEnabled(), true);
    await assert.rejects(() => service.assertValidToken(undefined), assertCaptchaInvalid);
    await assert.rejects(() => service.assertValidToken(""), assertCaptchaInvalid);
    await assert.rejects(() => service.assertValidToken(42), assertCaptchaInvalid);
    await assert.rejects(
      () => service.assertValidToken("x".repeat(2049)),
      assertCaptchaInvalid,
    );
  });

  it("accepts a token Cloudflare confirms, sending secret and response", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    const bodies: string[] = [];
    stubFetch(async (input, init) => {
      assert.equal(
        String(input),
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });

    await new TurnstileService().assertValidToken("  token-123  ");

    const params = new URLSearchParams(bodies[0]);
    assert.equal(params.get("secret"), "secret-key");
    // The widget token is trimmed before verification.
    assert.equal(params.get("response"), "token-123");
  });

  it("rejects a token Cloudflare refuses", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }),
          { status: 200 },
        ),
    );

    await assert.rejects(
      () => new TurnstileService().assertValidToken("stale-token"),
      assertCaptchaInvalid,
    );
  });

  it("fails open when siteverify is unreachable", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    stubFetch(async () => {
      throw new Error("network down");
    });

    // Cloudflare being down must not lock people out of the product.
    await new TurnstileService().assertValidToken("token-123");
  });

  it("gates the tenant login before any database work", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    stubFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));

    let userLookups = 0;
    const authService = new AuthService(
      {
        user: {
          findUnique: async () => {
            userLookups += 1;
            return null;
          },
        },
      } as never,
      { verifyPassword: async () => true } as never,
      new RolesService(),
      {} as never,
      {
        resolveTenant: async () => ({ tenant: { id: "tenant-a" } }),
      } as never,
      new TurnstileService(),
    );

    await assert.rejects(
      () =>
        authService.login(
          {
            email: "user@example.com",
            password: "secret",
            tenantSlug: "tenant-a",
            captchaToken: "rejected-token",
          },
          { header: () => undefined, path: "/tenant-a" } as never,
          {} as never,
        ),
      assertCaptchaInvalid,
    );
    assert.equal(userLookups, 0);
  });

  it("gates the platform login before any database work", async () => {
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    stubFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));

    let userLookups = 0;
    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => {
            userLookups += 1;
            return null;
          },
        },
      } as never,
      { verifyPassword: async () => true } as never,
      {} as never,
      new TurnstileService(),
    );

    await assert.rejects(
      () =>
        service.login(
          { email: "owner@vizitum.dev", password: "secret" },
          { header: () => undefined } as never,
          {} as never,
        ),
      assertCaptchaInvalid,
    );
    assert.equal(userLookups, 0);
  });
});
