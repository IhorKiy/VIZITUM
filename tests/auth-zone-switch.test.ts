import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { SESSION_COOKIE_NAME } from "../src/modules/auth/auth.constants";
import { RolesService } from "../src/modules/roles/roles.service";
import { createTestLoginBackoff } from "./fixtures/login-backoff";

describe("auth zone switch", () => {
  it("requires an active session", async () => {
    const authService = new AuthService(
      {} as never,
      {} as never,
      new RolesService(),
      { findActiveSessionByToken: async () => null } as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
          createResponse(),
        ),
      UnauthorizedException,
    );
  });

  it("rejects an unknown zone literal before touching the session", async () => {
    let sessionLookupCount = 0;
    const authService = new AuthService(
      {} as never,
      {} as never,
      new RolesService(),
      {
        findActiveSessionByToken: async () => {
          sessionLookupCount += 1;
          return null;
        },
      } as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "not-a-real-zone" },
          createRequest("session-token"),
          createResponse(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "INVALID_ZONE",
        );
        return true;
      },
    );
    assert.equal(sessionLookupCount, 0);
  });

  it("checks zone switching against the session tenant user record", async () => {
    const session = createSession();
    const userQueries: unknown[] = [];
    const prisma = {
      user: {
        findFirst: async (query: unknown) => {
          userQueries.push(query);
          return null;
        },
      },
    };
    const authService = new AuthService(
      prisma as never,
      {} as never,
      new RolesService(),
      createSessionService(session) as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
          createResponse(),
        ),
      UnauthorizedException,
    );
    assert.deepEqual(userQueries, [
      {
        where: {
          id: session.userId,
          tenantId: session.tenantId,
        },
        include: { roles: true },
      },
    ]);
  });

  it("rejects a zone the user's permissions don't cover, without persisting", async () => {
    const session = createSession();
    const prisma = {
      user: {
        findFirst: async () => ({
          id: session.userId,
          email: "field@tenant-a.test",
          name: "Field Rep",
          status: "active",
          lastSelectedRoleCode: "field_representative",
          lastSelectedZone: null,
          roles: [{ roleCode: "field_representative" }],
        }),
        update: async () => {
          throw new Error("must not persist a rejected zone");
        },
      },
    };
    const authService = new AuthService(
      prisma as never,
      {} as never,
      new RolesService(),
      createSessionService(session) as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    // field_representative holds no admin-zone permission (see
    // tests/nav-zones.test.ts / src/modules/auth/zones.ts).
    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
          createResponse(),
        ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          (error.getResponse() as { code: string }).code,
          "ZONE_NOT_AVAILABLE",
        );
        return true;
      },
    );
  });

  it("persists and returns the newly selected zone when it is available", async () => {
    const session = createSession();
    const updateCalls: unknown[] = [];
    const baseUser = {
      id: session.userId,
      email: "admin@tenant-a.test",
      name: "Company Admin",
      status: "active",
      lastSelectedRoleCode: "company_admin",
      lastSelectedZone: null,
      roles: [{ roleCode: "company_admin" }],
    };
    const prisma = {
      user: {
        findFirst: async () => baseUser,
        update: async (query: {
          where: { id: string };
          data: { lastSelectedZone: string };
        }) => {
          updateCalls.push(query);
          return { ...baseUser, lastSelectedZone: query.data.lastSelectedZone };
        },
      },
    };
    const rotations: string[] = [];
    const cookies: { name: string; value: string }[] = [];
    const authService = new AuthService(
      prisma as never,
      {} as never,
      new RolesService(),
      createSessionService(session, rotations) as never,
      {} as never,
      { assertValidToken: async () => {} } as never,
      createTestLoginBackoff(),
    );

    const result = await authService.switchZone(
      { zone: "admin" },
      createRequest("session-token"),
      createResponse(cookies),
    );

    assert.equal(result.user.lastSelectedZone, "admin");
    assert.deepEqual(result.roleCodes, ["company_admin"]);
    assert.deepEqual(updateCalls, [
      {
        where: { id: session.userId },
        data: { lastSelectedZone: "admin" },
      },
    ]);
    // The switch changes what the session may do, so the token it was
    // carrying stops working — anything that captured the old value is no
    // longer holding a credential for the new privilege level.
    assert.deepEqual(rotations, [session.id]);
    // Both cookies, not just the session one: the CSRF token is an HMAC keyed
    // on the session token, so a rotated session leaves the old CSRF cookie
    // unverifiable and every later mutation would fail.
    assert.deepEqual(
      cookies.map((cookie) => cookie.name),
      ["vizitum_session", "vizitum_csrf"],
    );
    assert.equal(cookies[0].value, "rotated-session-token");
  });
});

function createSession() {
  return {
    id: "session-a",
    tenantId: "tenant-a",
    userId: "user-a",
    sessionTokenHash: "hash",
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    lastSeenAt: null,
    userAgentHash: null,
    ipHash: null,
  };
}

function createSessionService(
  session: ReturnType<typeof createSession>,
  rotations: string[] = [],
) {
  return {
    findActiveSessionByToken: async () => session,
    // A zone or role switch changes what the session may do, so the service
    // mints a new token for it. Recorded rather than ignored so the test
    // below can assert the rotation actually happened.
    rotateSessionToken: async (sessionId: string) => {
      rotations.push(sessionId);

      return "rotated-session-token";
    },
  };
}

// switchZone/switchRole now write the rotated session and CSRF cookies.
function createResponse(cookies: { name: string; value: string }[] = []) {
  return {
    cookie: (name: string, value: string) => {
      cookies.push({ name, value });
    },
  } as never;
}

function createRequest(token?: string) {
  return {
    requestId: "request-a",
    header: (name: string) => {
      if (name.toLowerCase() === "cookie" && token) {
        return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
      }

      return undefined;
    },
  } as never;
}
