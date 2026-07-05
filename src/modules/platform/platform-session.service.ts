import { Injectable } from "@nestjs/common";
import type { PlatformSession, PlatformUser } from "@prisma/client";

import {
  issueSessionToken,
  isSessionActive,
} from "../../common/session-lifecycle";
import { hashValue } from "../auth/auth-crypto";
import { SESSION_TOKEN_BYTES, SESSION_TTL_DAYS } from "../auth/auth.constants";
import { PrismaService } from "../prisma/prisma.service";

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
    const { token, expiresAt } = issueSessionToken(
      SESSION_TOKEN_BYTES,
      SESSION_TTL_DAYS,
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

    if (!session || !isSessionActive(session)) {
      return null;
    }

    await this.prisma.platformSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return session;
  }

  async revokeSessionByToken(token: string): Promise<void> {
    await this.prisma.platformSession.updateMany({
      where: { sessionTokenHash: hashValue(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
