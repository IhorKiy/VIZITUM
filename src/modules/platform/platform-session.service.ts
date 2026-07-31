import { Injectable } from "@nestjs/common";
import type { PlatformSession, PlatformUser } from "@prisma/client";

import {
  issueSessionTokenForHours,
  isSessionActive,
  touchSession,
} from "../../common/session-lifecycle";
import { hashValue } from "../auth/auth-crypto";
import { SESSION_TOKEN_BYTES } from "../auth/auth.constants";
import { PrismaService } from "../prisma/prisma.service";
import {
  PLATFORM_SESSION_IDLE_TIMEOUT_HOURS,
  PLATFORM_SESSION_TTL_HOURS,
} from "./platform-auth.constants";

export type CreatePlatformSessionInput = {
  platformUserId: string;
  userAgent?: string;
  ipAddress?: string;
};

export type CreatedPlatformSession = {
  session: PlatformSession;
  token: string;
};

@Injectable()
export class PlatformSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    input: CreatePlatformSessionInput,
  ): Promise<CreatedPlatformSession> {
    // Hours, not the tenant session's days — one account reaches every
    // tenant's data. See PLATFORM_SESSION_TTL_HOURS.
    const { token, expiresAt } = issueSessionTokenForHours(
      SESSION_TOKEN_BYTES,
      PLATFORM_SESSION_TTL_HOURS,
    );
    const sessionTokenHash = hashValue(token);

    const session = await this.prisma.platformSession.create({
      data: {
        platformUserId: input.platformUserId,
        sessionTokenHash,
        expiresAt,
        userAgentHash: input.userAgent ? hashValue(input.userAgent) : null,
        ipHash: input.ipAddress ? hashValue(input.ipAddress) : null,
      },
    });

    return { session, token };
  }

  async findActiveSessionByToken(
    token: string,
  ): Promise<(PlatformSession & { platformUser: PlatformUser }) | null> {
    const session = await this.prisma.platformSession.findUnique({
      where: { sessionTokenHash: hashValue(token) },
      include: { platformUser: true },
    });

    if (
      !session ||
      !isSessionActive(session, PLATFORM_SESSION_IDLE_TIMEOUT_HOURS)
    ) {
      return null;
    }

    await touchSession(this.prisma.platformSession, session.id);

    return session;
  }

  async revokeSessionByToken(token: string): Promise<void> {
    await this.prisma.platformSession.updateMany({
      where: { sessionTokenHash: hashValue(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
