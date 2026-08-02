import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";

import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import {
  createTestPlatformMfa,
  TEST_CHALLENGE_EXPIRY,
} from "./fixtures/platform-mfa";
import { createTestAuthAudit } from "./fixtures/auth-audit";

describe("platform auth", () => {
  it("answers a correct password with a code challenge, not a session", async () => {
    const owner = {
      id: "owner-1",
      email: "owner@vizitum.dev",
      name: "Platform Owner",
      passwordHash: "hash",
      status: "active",
    };
    const updates: unknown[] = [];
    const sessionInputs: unknown[] = [];
    const cookies: Array<{ name: string; token: string }> = [];

    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => owner,
          update: async (args: unknown) => {
            updates.push(args);
            return owner;
          },
        },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      {
        createSession: async (input: unknown) => {
          sessionInputs.push(input);
          return { token: "platform-token", session: { id: "session-1" } };
        },
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    const result = await service.login(
      { email: "  OWNER@vizitum.dev ", password: "secret" },
      createRequest(),
      createResponse(cookies),
    );

    // A correct password gets the owner to the second step and no further.
    // One platform account reaches every tenant's data, so it is exactly the
    // account a password alone must not be enough for.
    assert.deepEqual(result, {
      step: "mfa",
      challengeToken: "login-challenge-token",
      expiresAt: TEST_CHALLENGE_EXPIRY,
    });
    assert.equal(sessionInputs.length, 0, "no session yet");
    assert.equal(updates.length, 0, "lastLoginAt waits for the second step");
    assert.equal(cookies.length, 0, "no cookies until the code is accepted");
  });

  it("issues a platform-owner session once the code is accepted", async () => {
    const owner = {
      id: "owner-1",
      email: "owner@vizitum.dev",
      name: "Platform Owner",
      passwordHash: "hash",
      status: "active",
      totpSecret: "SECRET",
      totpConfirmedAt: new Date(),
      totpRecoveryCodeHashes: [],
    };
    const updates: unknown[] = [];
    const sessionInputs: unknown[] = [];
    const cookies: Array<{ name: string; token: string }> = [];

    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => owner,
          update: async (args: unknown) => {
            updates.push(args);
            return owner;
          },
        },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      {
        createSession: async (input: unknown) => {
          sessionInputs.push(input);
          return { token: "platform-token", session: { id: "session-1" } };
        },
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    const result = await service.verifyMfa(
      { challengeToken: "login-challenge-token", code: "123456" },
      createRequest(),
      createResponse(cookies),
    );

    assert.deepEqual(result, {
      step: "session",
      platformUser: {
        id: "owner-1",
        email: "owner@vizitum.dev",
        name: "Platform Owner",
        status: "active",
      },
      roleCodes: ["platform_owner"],
      permissions: [
        PERMISSIONS.PLATFORM_TENANTS_READ,
        PERMISSIONS.PLATFORM_TENANTS_MANAGE,
        PERMISSIONS.PLATFORM_OPERATIONS_READ,
      ],
      recoveryCodesRemaining: 0,
    });
    assert.equal(sessionInputs.length, 1);
    assert.equal(updates.length, 1);
    assert.ok(cookies.some((cookie) => cookie.name === "vizitum_platform_session"));
    assert.ok(cookies.some((cookie) => cookie.name === "vizitum_platform_csrf"));
  });

  it("rejects an unknown platform user", async () => {
    const service = new PlatformAuthService(
      { platformUser: { findUnique: async () => null } } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      { createSession: async () => ({ token: "t", session: {} }) } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    await assert.rejects(
      () =>
        service.login(
          { email: "ghost@vizitum.dev", password: "secret" },
          createRequest(),
          createResponse([]),
        ),
      UnauthorizedException,
    );
  });

  it("rejects a suspended platform user", async () => {
    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => ({
            id: "owner-1",
            email: "owner@vizitum.dev",
            name: "Owner",
            passwordHash: "hash",
            status: "suspended",
          }),
        },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      { createSession: async () => ({ token: "t", session: {} }) } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    await assert.rejects(
      () =>
        service.login(
          { email: "owner@vizitum.dev", password: "secret" },
          createRequest(),
          createResponse([]),
        ),
      UnauthorizedException,
    );
  });

  it("rejects an incorrect password", async () => {
    let sessionCreated = false;
    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => ({
            id: "owner-1",
            email: "owner@vizitum.dev",
            name: "Owner",
            passwordHash: "hash",
            status: "active",
          }),
        },
      } as never,
      {
        verifyPassword: async () => false,
        rehashIfNeeded: async () => null,
      } as never,
      {
        createSession: async () => {
          sessionCreated = true;
          return { token: "t", session: {} };
        },
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    await assert.rejects(
      () =>
        service.login(
          { email: "owner@vizitum.dev", password: "wrong" },
          createRequest(),
          createResponse([]),
        ),
      UnauthorizedException,
    );
    assert.equal(sessionCreated, false);
  });

  it("requires an active session for getCurrentPlatformUser", async () => {
    const service = new PlatformAuthService(
      { platformUser: { findUnique: async () => null } } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      { findActiveSessionByToken: async () => null } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    await assert.rejects(
      () => service.getCurrentPlatformUser(createRequest()),
      UnauthorizedException,
    );
  });
});

function createRequest(platformSessionToken) {
  return {
    requestId: "request-a",
    ip: "127.0.0.1",
    header: (name: string) => {
      const headerName = name.toLowerCase();

      if (headerName === "user-agent") {
        return "test-agent";
      }

      if (headerName === "cookie" && platformSessionToken) {
        return `vizitum_platform_session=${platformSessionToken}`;
      }

      return undefined;
    },
  } as never;
}

function createResponse(cookies: Array<{ name: string; token: string }>) {
  return {
    cookie: (name: string, token: string) => {
      cookies.push({ name, token });
    },
  } as never;
}
