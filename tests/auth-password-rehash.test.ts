import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AuthService } from "../src/modules/auth/auth.service";
import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestAuthAudit } from "./fixtures/auth-audit";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import { createTestPlatformMfa } from "./fixtures/platform-mfa";

// Item 3.6 of the security remediation plan: a successful login upgrades a
// password hash whose parameters have drifted from PASSWORD_HASH_OPTIONS,
// using the password this same request already proved correct — rather than
// only detecting the need and never acting on it.
describe("rehash on login", () => {
  it("persists the rehashed value alongside lastLoginAt on tenant login", async () => {
    const updates: Record<string, unknown>[] = [];
    const user = {
      id: "user-a",
      email: "rep@example.com",
      firstName: "Rep",
      lastName: "One",
      name: "Rep One",
      status: "active",
      passwordHash: "stale-hash",
      lastSelectedRoleCode: null,
      lastSelectedZone: null,
      roles: [{ roleCode: "field_representative" }],
    };

    const service = new AuthService(
      {
        user: {
          findUnique: async () => user,
          update: async (args: { data: Record<string, unknown> }) => {
            updates.push(args.data);
            return user;
          },
        },
        tenantSetting: { findMany: async () => [] },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => "fresh-hash",
      } as never,
      new RolesService(),
      { createSession: async () => ({ token: "session-token" }) } as never,
      {
        resolveTenant: async () => ({ tenant: { id: "tenant-a", slug: "acme" } }),
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestAuthAudit(),
    );

    await service.login(
      { email: "rep@example.com", password: "correct", tenantSlug: "acme" },
      createRequest(),
      createResponse(),
    );

    assert.equal(updates.length, 1);
    assert.equal(updates[0].passwordHash, "fresh-hash");
    assert.ok(updates[0].lastLoginAt instanceof Date);
  });

  it("does not touch passwordHash on tenant login when no rehash is needed", async () => {
    const updates: Record<string, unknown>[] = [];
    const user = {
      id: "user-a",
      email: "rep@example.com",
      firstName: "Rep",
      lastName: "One",
      name: "Rep One",
      status: "active",
      passwordHash: "current-hash",
      lastSelectedRoleCode: null,
      lastSelectedZone: null,
      roles: [{ roleCode: "field_representative" }],
    };

    const service = new AuthService(
      {
        user: {
          findUnique: async () => user,
          update: async (args: { data: Record<string, unknown> }) => {
            updates.push(args.data);
            return user;
          },
        },
        tenantSetting: { findMany: async () => [] },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => null,
      } as never,
      new RolesService(),
      { createSession: async () => ({ token: "session-token" }) } as never,
      {
        resolveTenant: async () => ({ tenant: { id: "tenant-a", slug: "acme" } }),
      } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestAuthAudit(),
    );

    await service.login(
      { email: "rep@example.com", password: "correct", tenantSlug: "acme" },
      createRequest(),
      createResponse(),
    );

    assert.equal(updates.length, 1);
    assert.equal("passwordHash" in updates[0], false);
  });

  it("persists the rehashed value on platform login, ahead of the MFA step", async () => {
    const updates: Record<string, unknown>[] = [];
    const owner = {
      id: "owner-1",
      email: "owner@vizitum.dev",
      name: "Platform Owner",
      passwordHash: "stale-hash",
      status: "active",
      totpSecret: "secret",
      totpConfirmedAt: new Date(),
      totpRecoveryCodeHashes: [],
    };

    const service = new PlatformAuthService(
      {
        platformUser: {
          findUnique: async () => owner,
          update: async (args: { data: Record<string, unknown> }) => {
            updates.push(args.data);
            return owner;
          },
        },
      } as never,
      {
        verifyPassword: async () => true,
        rehashIfNeeded: async () => "fresh-hash",
      } as never,
      { createSession: async () => ({ token: "platform-token" }) } as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
      createTestPlatformMfa(),
      createTestAuthAudit(),
    );

    await service.login(
      { email: "owner@vizitum.dev", password: "correct" },
      createRequest(),
    );

    assert.deepEqual(updates, [{ passwordHash: "fresh-hash" }]);
  });
});

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
