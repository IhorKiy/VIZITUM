import { Injectable } from "@nestjs/common";
import type { Session } from "@prisma/client";

import {
  issueSessionToken,
  isSessionActive,
  touchSession,
} from "../../common/session-lifecycle";
import { PrismaService } from "../prisma/prisma.service";
import {
  SESSION_IDLE_TIMEOUT_HOURS,
  SESSION_TOKEN_BYTES,
  SESSION_TTL_DAYS,
} from "./auth.constants";
import { hashValue } from "./auth-crypto";

export type CreateSessionInput = {
  tenantId: string;
  userId: string;
  userAgent?: string;
  ipAddress?: string;
};

export type CreatedSession = {
  session: Session;
  token: string;
};

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    const { token, expiresAt } = issueSessionToken(
      SESSION_TOKEN_BYTES,
      SESSION_TTL_DAYS,
    );
    const sessionTokenHash = hashValue(token);

    const session = await this.prisma.session.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        sessionTokenHash,
        expiresAt,
        userAgentHash: input.userAgent ? hashValue(input.userAgent) : null,
        ipHash: input.ipAddress ? hashValue(input.ipAddress) : null,
      },
    });

    return { session, token };
  }

  async findActiveSessionByToken(token: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionTokenHash: hashValue(token) },
    });

    if (!session || !isSessionActive(session, SESSION_IDLE_TIMEOUT_HOURS)) {
      return null;
    }

    await touchSession(this.prisma.session, session.id);

    return session;
  }

  /**
   * Mints a new token for an existing session, in place.
   *
   * Called whenever what the session is *allowed to do* changes — a role or
   * zone switch. Without it the same token spans both privilege levels, so a
   * token captured before an escalation keeps working after it, and anything
   * that logged or cached the old value is still holding a live credential
   * for the new one.
   *
   * The row is updated rather than replaced so the session keeps its identity
   * — created-at, the user-agent and IP hashes kept for forensics, and the id
   * that revokeOtherUserSessions preserves. The absolute TTL restarts, which
   * is the same treatment a fresh sign-in gets and is bounded by the same
   * seven days.
   */
  async rotateSessionToken(sessionId: string): Promise<string> {
    const { token, expiresAt } = issueSessionToken(
      SESSION_TOKEN_BYTES,
      SESSION_TTL_DAYS,
    );

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        sessionTokenHash: hashValue(token),
        expiresAt,
        lastSeenAt: new Date(),
      },
    });

    return token;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSessionByToken(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        sessionTokenHash: hashValue(token),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeUserSessions(tenantId: string, userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  // Everything except the session doing the revoking. Used after a password
  // change: whoever else was holding a session for this account — including
  // whoever the password was being changed *because* of — is signed out,
  // while the person who just proved they know the current password stays
  // where they are rather than being bounced to the login screen.
  async revokeOtherUserSessions(
    tenantId: string,
    userId: string,
    keepSessionId: string,
  ): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
        id: { not: keepSessionId },
      },
      data: { revokedAt: new Date() },
    });

    return count;
  }
}
