import { Injectable } from "@nestjs/common";
import type { Session } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import {
  HASH_ALGORITHM,
  SESSION_TOKEN_BYTES,
  SESSION_TTL_DAYS,
} from "./auth.constants";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const sessionTokenHash = hashValue(token);
    const expiresAt = new Date(
      Date.now() + SESSION_TTL_DAYS * MILLISECONDS_PER_DAY,
    );

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

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return session;
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
}

function hashValue(value: string): string {
  return createHash(HASH_ALGORITHM).update(value).digest("hex");
}
