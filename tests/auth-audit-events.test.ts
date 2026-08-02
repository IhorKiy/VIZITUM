import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";

import { AuthAuditService } from "../src/modules/auth/auth-audit.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { PlatformAuthService } from "../src/modules/platform/platform-auth.service";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestAuthAudit } from "./fixtures/auth-audit";
import { createTestLoginBackoff } from "./fixtures/login-backoff";
import { createTestPlatformMfa } from "./fixtures/platform-mfa";

// Item 3.5 of the security remediation plan: without these rows, the
// brute-force controls in 1.1 stop traffic but leave no trace of it, so
// nothing can be reconstructed after the fact — which is also why direct
// credential traffic against the API was recorded there as unmeasurable.
describe("auth audit events", () => {
  describe("tenant sign-in", () => {
    it("records a successful sign-in against the account", async () => {
      const audit = createTestAuthAudit();
      const service = createAuthService({ audit, user: activeUser() });

      await service.login(
        { email: "rep@example.com", password: "secret", tenantSlug: "acme" },
        createRequest(),
        createResponse(),
      );

      assert.deepEqual(audit.events, [
        {
          eventType: "auth.login_succeeded",
          tenantId: "tenant-a",
          userId: "user-a",
          email: "rep@example.com",
          requestId: "request-a",
        },
      ]);
    });

    it("records a failed sign-in against an address that matches no account", async () => {
      const audit = createTestAuthAudit();
      const service = createAuthService({ audit, user: null });

      await assert.rejects(
        () =>
          service.login(
            { email: "ghost@example.com", password: "secret", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.equal(audit.events.length, 1);
      assert.equal(audit.events[0]?.eventType, "auth.login_failed");
      assert.equal(audit.events[0]?.reason, "unknown_account");
      // No account to point at, but the address the attempt was made against
      // is the whole value of the row.
      assert.equal(audit.events[0]?.userId, null);
      assert.equal(audit.events[0]?.email, "ghost@example.com");
    });

    it("tells a wrong password apart from a missing account, and a suspended account from both", async () => {
      const wrongPassword = createTestAuthAudit();
      await assert.rejects(
        () =>
          createAuthService({
            audit: wrongPassword,
            user: activeUser(),
            passwordMatches: false,
          }).login(
            { email: "rep@example.com", password: "wrong", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );
      assert.equal(wrongPassword.events[0]?.reason, "wrong_password");
      assert.equal(wrongPassword.events[0]?.userId, "user-a");

      const suspended = createTestAuthAudit();
      await assert.rejects(
        () =>
          createAuthService({
            audit: suspended,
            user: { ...activeUser(), status: "suspended" },
          }).login(
            { email: "rep@example.com", password: "secret", tenantSlug: "acme" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );
      assert.equal(suspended.events[0]?.reason, "inactive_account");
      assert.equal(suspended.events[0]?.userId, "user-a");
    });

    it("records the sign-out against the session's own account", async () => {
      const audit = createTestAuthAudit();
      const revoked: string[] = [];
      const service = createAuthService({
        audit,
        user: activeUser(),
        sessionService: {
          findActiveSessionByToken: async () => ({
            id: "session-a",
            tenantId: "tenant-a",
            userId: "user-a",
          }),
          revokeSessionByToken: async (token: string) => {
            revoked.push(token);
          },
        },
      });

      const result = await service.logout(
        createRequest("session-token"),
        createResponse(),
      );

      assert.deepEqual(result, { ok: true });
      assert.deepEqual(revoked, ["session-token"]);
      assert.deepEqual(audit.events, [
        {
          eventType: "auth.logged_out",
          tenantId: "tenant-a",
          userId: "user-a",
          requestId: "request-a",
        },
      ]);
    });

    it("still clears the cookies, and records nothing, when the sign-out carries no live session", async () => {
      const audit = createTestAuthAudit();
      const cleared: string[] = [];
      const service = createAuthService({
        audit,
        user: activeUser(),
        sessionService: {
          findActiveSessionByToken: async () => null,
          revokeSessionByToken: async () => {},
        },
      });

      await service.logout(
        createRequest("stale-token"),
        createResponse(cleared),
      );

      assert.deepEqual(audit.events, []);
      assert.deepEqual(cleared, ["vizitum_session", "vizitum_csrf"]);
    });
  });

  describe("platform sign-in", () => {
    it("records the completed sign-in at the code step, not the password step", async () => {
      const audit = createTestAuthAudit();
      const service = createPlatformAuthService({ audit });

      await service.login(
        { email: "owner@vizitum.dev", password: "secret" },
        createRequest(),
        createResponse(),
      );

      // The password alone never yields a session, so it must never read as a
      // completed sign-in either.
      assert.deepEqual(audit.events, []);

      await service.verifyMfa(
        { challengeToken: "challenge-token", code: "123456" },
        createRequest(),
        createResponse(),
      );

      assert.deepEqual(audit.events, [
        {
          eventType: "platform.login_succeeded",
          platformUserId: "owner-1",
          email: "owner@vizitum.dev",
          method: "totp",
          requestId: "request-a",
        },
      ]);
    });

    it("records a wrong second factor separately from a wrong password", async () => {
      const wrongCode = createTestAuthAudit();
      const service = createPlatformAuthService({
        audit: wrongCode,
        codeAccepted: false,
      });

      await service.login(
        { email: "owner@vizitum.dev", password: "secret" },
        createRequest(),
        createResponse(),
      );
      await assert.rejects(
        () =>
          service.verifyMfa(
            { challengeToken: "challenge-token", code: "000000" },
            createRequest(),
            createResponse(),
          ),
        BadRequestException,
      );

      assert.equal(wrongCode.events.length, 1);
      assert.equal(wrongCode.events[0]?.eventType, "platform.login_failed");
      assert.equal(wrongCode.events[0]?.reason, "wrong_code");
      assert.equal(wrongCode.events[0]?.method, "totp");

      const wrongPassword = createTestAuthAudit();
      await assert.rejects(
        () =>
          createPlatformAuthService({
            audit: wrongPassword,
            passwordMatches: false,
          }).login(
            { email: "owner@vizitum.dev", password: "wrong" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );
      assert.equal(wrongPassword.events[0]?.reason, "wrong_password");
    });

    it("records an unknown platform address with no account attached", async () => {
      const audit = createTestAuthAudit();

      await assert.rejects(
        () =>
          createPlatformAuthService({ audit, platformUser: null }).login(
            { email: "ghost@vizitum.dev", password: "secret" },
            createRequest(),
            createResponse(),
          ),
        UnauthorizedException,
      );

      assert.equal(audit.events[0]?.reason, "unknown_account");
      assert.equal(audit.events[0]?.platformUserId, null);
      assert.equal(audit.events[0]?.email, "ghost@vizitum.dev");
    });

    it("records the sign-out against the session's owner", async () => {
      const audit = createTestAuthAudit();
      const service = createPlatformAuthService({
        audit,
        session: { id: "session-1", platformUserId: "owner-1" },
      });

      await service.logout(
        createRequest("platform-token"),
        createResponse(),
      );

      assert.deepEqual(audit.events, [
        {
          eventType: "platform.logged_out",
          platformUserId: "owner-1",
          requestId: "request-a",
        },
      ]);
    });
  });

  describe("the rows themselves", () => {
    it("writes a tenant event as an audit row, with the address in the metadata", async () => {
      const rows: unknown[] = [];
      const service = new AuthAuditService({
        auditEvent: {
          create: async ({ data }: { data: unknown }) => {
            rows.push(data);
            return data;
          },
        },
      } as never);

      await service.recordTenantLoginFailed({
        tenantId: "tenant-a",
        userId: null,
        email: "ghost@example.com",
        requestId: "request-a",
        reason: "unknown_account",
      });

      assert.deepEqual(rows, [
        {
          tenantId: "tenant-a",
          actorUserId: null,
          entityType: "user",
          entityId: "unknown",
          eventType: "auth.login_failed",
          metadata: { email: "ghost@example.com", reason: "unknown_account" },
          requestId: "request-a",
        },
      ]);
    });

    it("writes a platform event with no tenant, since a platform owner reaches every tenant", async () => {
      const rows: unknown[] = [];
      const service = new AuthAuditService({
        platformOperationEvent: {
          create: async ({ data }: { data: unknown }) => {
            rows.push(data);
            return data;
          },
        },
      } as never);

      await service.recordPlatformLoginSucceeded({
        platformUserId: "owner-1",
        email: "owner@vizitum.dev",
        method: "recovery_code",
      });

      assert.deepEqual(rows, [
        {
          tenantId: null,
          actorUserId: "owner-1",
          eventType: "platform.login_succeeded",
          metadata: {
            email: "owner@vizitum.dev",
            method: "recovery_code",
          },
          requestId: undefined,
        },
      ]);
    });

    it("never lets a failed audit write break the sign-in it was recording", async () => {
      const service = new AuthAuditService({
        auditEvent: {
          create: async () => {
            throw new Error("audit table unavailable");
          },
        },
      } as never);

      // Resolves rather than rejects: an unavailable audit table must degrade
      // the trail, not refuse the login — and on the failure path it must not
      // turn a wrong password into a 500.
      await service.recordTenantLoginFailed({
        tenantId: "tenant-a",
        userId: "user-a",
        email: "rep@example.com",
        reason: "wrong_password",
      });
    });
  });
});

function activeUser() {
  return {
    id: "user-a",
    email: "rep@example.com",
    firstName: "Rep",
    lastName: "One",
    name: "Rep One",
    status: "active",
    passwordHash: "hash",
    lastSelectedRoleCode: null,
    lastSelectedZone: null,
    roles: [{ roleCode: "field_representative" }],
  };
}

function createAuthService(options: {
  audit: ReturnType<typeof createTestAuthAudit>;
  user: ReturnType<typeof activeUser> | null;
  passwordMatches?: boolean;
  sessionService?: unknown;
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
    {
      verifyPassword: async () => options.passwordMatches ?? true,
    } as never,
    new RolesService(),
    (options.sessionService ?? {
      createSession: async () => ({ token: "session-token" }),
    }) as never,
    {
      resolveTenant: async () => ({
        tenant: { id: "tenant-a", slug: "acme" },
      }),
    } as never,
    { assertValidToken: async () => {} } as never,
    createTestLoginBackoff(),
    options.audit,
  );
}

function createPlatformAuthService(options: {
  audit: ReturnType<typeof createTestAuthAudit>;
  platformUser?: Record<string, unknown> | null;
  passwordMatches?: boolean;
  codeAccepted?: boolean;
  session?: { id: string; platformUserId: string };
}) {
  const owner =
    options.platformUser === undefined
      ? {
          id: "owner-1",
          email: "owner@vizitum.dev",
          name: "Platform Owner",
          passwordHash: "hash",
          status: "active",
          totpSecret: "secret",
          totpConfirmedAt: new Date(),
          totpRecoveryCodeHashes: [],
        }
      : options.platformUser;

  const mfa = createTestPlatformMfa();
  const originalVerify = mfa.verifyTotpCode.bind(mfa);

  mfa.verifyTotpCode = (secret: string, code: unknown) =>
    options.codeAccepted === false ? false : originalVerify(secret, code);

  return new PlatformAuthService(
    {
      platformUser: {
        findUnique: async () => owner,
        findFirst: async () => owner,
        update: async () => owner,
      },
    } as never,
    { verifyPassword: async () => options.passwordMatches ?? true } as never,
    {
      createSession: async () => ({ token: "platform-token" }),
      findActiveSessionByToken: async () => options.session ?? null,
      revokeSessionByToken: async () => {},
    } as never,
    { assertValidToken: async () => {} } as never,
    createTestLoginBackoff(),
    mfa as never,
    options.audit,
  );
}

function createRequest(token?: string) {
  const cookie = token ? `vizitum_session=${token}` : undefined;
  const platformCookie = token ? `vizitum_platform_session=${token}` : undefined;

  return {
    requestId: "request-a",
    path: "/acme",
    ip: "203.0.113.10",
    header: (name: string) =>
      name.toLowerCase() === "cookie"
        ? [cookie, platformCookie].filter(Boolean).join("; ") || undefined
        : undefined,
  } as never;
}

function createResponse(cleared: string[] = []) {
  return {
    cookie: () => {},
    clearCookie: (name: string) => {
      cleared.push(name);
    },
  } as never;
}
