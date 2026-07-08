import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";

import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { PERMISSIONS } from "../src/modules/roles/permissions";

describe("platform auth", () => {
  it("issues a platform-owner session for valid credentials", async () => {
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
      { verifyPassword: async () => true } as never,
      {
        createSession: async (input: unknown) => {
          sessionInputs.push(input);
          return { token: "platform-token", session: { id: "session-1" } };
        },
      } as never,
    );

    const result = await service.login(
      { email: "  OWNER@vizitum.dev ", password: "secret" },
      createRequest(),
      createResponse(cookies),
    );

    assert.deepEqual(result, {
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
    });
    assert.equal(sessionInputs.length, 1);
    assert.equal(updates.length, 1);
    assert.ok(cookies.some((cookie) => cookie.name === "vizitum_platform_session"));
    assert.ok(cookies.some((cookie) => cookie.name === "vizitum_platform_csrf"));
  });

  it("rejects an unknown platform user", async () => {
    const service = new PlatformAuthService(
      { platformUser: { findUnique: async () => null } } as never,
      { verifyPassword: async () => true } as never,
      { createSession: async () => ({ token: "t", session: {} }) } as never,
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
      { verifyPassword: async () => true } as never,
      { createSession: async () => ({ token: "t", session: {} }) } as never,
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
      { verifyPassword: async () => false } as never,
      {
        createSession: async () => {
          sessionCreated = true;
          return { token: "t", session: {} };
        },
      } as never,
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
      { verifyPassword: async () => true } as never,
      { findActiveSessionByToken: async () => null } as never,
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
