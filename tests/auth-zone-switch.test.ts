import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";

import { AuthService } from "../src/modules/auth/auth.service";
import { SESSION_COOKIE_NAME } from "../src/modules/auth/auth.constants";
import { RolesService } from "../src/modules/roles/roles.service";

describe("auth zone switch", () => {
  it("requires an active session", async () => {
    const authService = new AuthService(
      {} as never,
      {} as never,
      new RolesService(),
      { findActiveSessionByToken: async () => null } as never,
      {} as never,
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
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
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "not-a-real-zone" },
          createRequest("session-token"),
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
    );

    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
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
    );

    // field_representative holds no admin-zone permission (see
    // tests/nav-zones.test.ts / src/modules/auth/zones.ts).
    await assert.rejects(
      () =>
        authService.switchZone(
          { zone: "admin" },
          createRequest("session-token"),
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
    const authService = new AuthService(
      prisma as never,
      {} as never,
      new RolesService(),
      createSessionService(session) as never,
      {} as never,
    );

    const result = await authService.switchZone(
      { zone: "admin" },
      createRequest("session-token"),
    );

    assert.equal(result.user.lastSelectedZone, "admin");
    assert.deepEqual(result.roleCodes, ["company_admin"]);
    assert.deepEqual(updateCalls, [
      {
        where: { id: session.userId },
        data: { lastSelectedZone: "admin" },
      },
    ]);
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

function createSessionService(session: ReturnType<typeof createSession>) {
  return {
    findActiveSessionByToken: async () => session,
  };
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
