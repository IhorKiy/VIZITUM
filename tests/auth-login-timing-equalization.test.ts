import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { DUMMY_PASSWORD_HASH } from "../src/modules/auth/password.service";
import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestAuthAudit } from "./fixtures/auth-audit";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import { createTestPlatformMfa } from "./fixtures/platform-mfa";

// Item 3.1 of the security remediation plan: argon2 used to run only when an
// account exists, so response timing told an unknown or inactive address
// apart from a real one rejected on password. Every case here asserts the
// same structural property — exactly one verifyPassword call per attempt,
// against a fixed hash when there is no real account to check and the
// account's own hash when there is — rather than measuring wall-clock time,
// which would be flaky and would not pin the actual guarantee.
describe("login timing equalization", () => {
  describe("tenant login", () => {
    it("verifies against the fixed dummy hash for an unknown account", async () => {
      const passwordService = createSpyPasswordService();
      const service = createAuthService({ passwordService, user: null });

      await assert.rejects(
        () =>
          service.login(
            { email: "ghost@example.com", password: "whatever", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: DUMMY_PASSWORD_HASH, password: "whatever" },
      ]);
    });

    it("verifies against the fixed dummy hash for an inactive account", async () => {
      const passwordService = createSpyPasswordService();
      const service = createAuthService({
        passwordService,
        user: { ...activeUser(), status: "suspended" },
      });

      await assert.rejects(
        () =>
          service.login(
            { email: "rep@example.com", password: "whatever", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: DUMMY_PASSWORD_HASH, password: "whatever" },
      ]);
    });

    it("verifies against the fixed dummy hash for an account with no password set", async () => {
      const passwordService = createSpyPasswordService();
      const service = createAuthService({
        passwordService,
        user: { ...activeUser(), passwordHash: null },
      });

      await assert.rejects(
        () =>
          service.login(
            { email: "rep@example.com", password: "whatever", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: DUMMY_PASSWORD_HASH, password: "whatever" },
      ]);
    });

    it("verifies against the account's own hash, once, when it exists", async () => {
      const passwordService = createSpyPasswordService({ result: false });
      const service = createAuthService({ passwordService, user: activeUser() });

      await assert.rejects(
        () =>
          service.login(
            { email: "rep@example.com", password: "wrong", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: "real-user-hash", password: "wrong" },
      ]);
    });
  });

  describe("platform login", () => {
    it("verifies against the fixed dummy hash for an unknown platform address", async () => {
      const passwordService = createSpyPasswordService();
      const service = createPlatformAuthService({
        passwordService,
        platformUser: null,
      });

      await assert.rejects(
        () =>
          service.login(
            { email: "ghost@vizitum.dev", password: "whatever" },
            createRequest(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: DUMMY_PASSWORD_HASH, password: "whatever" },
      ]);
    });

    it("verifies against the fixed dummy hash for an inactive platform account", async () => {
      const passwordService = createSpyPasswordService();
      const service = createPlatformAuthService({
        passwordService,
        platformUser: { ...platformOwner(), status: "suspended" },
      });

      await assert.rejects(
        () =>
          service.login(
            { email: "owner@vizitum.dev", password: "whatever" },
            createRequest(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: DUMMY_PASSWORD_HASH, password: "whatever" },
      ]);
    });

    it("verifies against the account's own hash, once, when it exists", async () => {
      const passwordService = createSpyPasswordService({ result: false });
      const service = createPlatformAuthService({
        passwordService,
        platformUser: platformOwner(),
      });

      await assert.rejects(
        () =>
          service.login(
            { email: "owner@vizitum.dev", password: "wrong" },
            createRequest(),
          ),
        UnauthorizedException,
      );

      assert.deepEqual(passwordService.calls, [
        { hashValue: "real-owner-hash", password: "wrong" },
      ]);
    });
  });
});

type SpyCall = { hashValue: string; password: string };

function createSpyPasswordService(options: { result?: boolean } = {}) {
  const calls: SpyCall[] = [];

  return {
    calls,
    verifyPassword: async (hashValue: string, password: string) => {
      calls.push({ hashValue, password });
      return options.result ?? true;
    },
  };
}

function activeUser() {
  return {
    id: "user-a",
    email: "rep@example.com",
    firstName: "Rep",
    lastName: "One",
    name: "Rep One",
    status: "active",
    passwordHash: "real-user-hash",
    lastSelectedRoleCode: null,
    lastSelectedZone: null,
    roles: [{ roleCode: "field_representative" }],
  };
}

function platformOwner() {
  return {
    id: "owner-1",
    email: "owner@vizitum.dev",
    name: "Platform Owner",
    passwordHash: "real-owner-hash",
    status: "active",
    totpSecret: "secret",
    totpConfirmedAt: new Date(),
    totpRecoveryCodeHashes: [],
  };
}

function createAuthService(options: {
  passwordService: ReturnType<typeof createSpyPasswordService>;
  user: ReturnType<typeof activeUser> | null;
}) {
  const prisma = {
    user: {
      findUnique: async () => options.user,
      update: async () => options.user,
    },
    tenantSetting: { findMany: async () => [] },
  };

  return new AuthService(
    prisma as never,
    options.passwordService as never,
    new RolesService(),
    { createSession: async () => ({ token: "session-token" }) } as never,
    {
      resolveTenant: async () => ({
        tenant: { id: "tenant-a", slug: "acme" },
      }),
    } as never,
    { assertValidToken: async () => {} } as never,
    createTestLoginBackoff(),
    createTestAuthAudit(),
  );
}

function createPlatformAuthService(options: {
  passwordService: ReturnType<typeof createSpyPasswordService>;
  platformUser: ReturnType<typeof platformOwner> | null;
}) {
  return new PlatformAuthService(
    {
      platformUser: {
        findUnique: async () => options.platformUser,
      },
    } as never,
    options.passwordService as never,
    {
      createSession: async () => ({ token: "platform-token" }),
    } as never,
    { assertValidToken: async () => {} } as never,
    createTestLoginBackoff(),
    createTestPlatformMfa(),
    createTestAuthAudit(),
  );
}

function createRequest() {
  return {
    requestId: "request-a",
    path: "/acme",
    ip: "203.0.113.10",
    header: () => undefined,
  } as never;
}

function createResponse() {
  return {
    cookie: () => {},
    clearCookie: () => {},
  } as never;
}
