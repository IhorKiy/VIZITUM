import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";

import { createCsrfToken, writeCsrfCookie } from "../auth/csrf";
import { PasswordService } from "../auth/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { ROLE_PERMISSION_MATRIX } from "../roles/role-permission.matrix";
import { PLATFORM_OWNER_ROLE_CODE } from "./platform-auth.types";
import type {
  PlatformLoginRequestBody,
  PlatformSessionResponse,
} from "./platform-auth.types";
import { readPlatformSessionToken } from "./platform-session-cookie";
import { writePlatformSessionCookie } from "./platform-session-cookie";
import { PlatformSessionService } from "./platform-session.service";

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly platformSessionService: PlatformSessionService,
  ) {}

  async login(
    body: PlatformLoginRequestBody,
    request: Request,
    response: Response,
  ): Promise<PlatformSessionResponse> {
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      throwInvalidCredentials();
    }

    const platformUser = await this.prisma.platformUser.findUnique({
      where: { email },
    });

    if (!platformUser || platformUser.status !== "active") {
      throwInvalidCredentials();
    }

    const passwordMatches = await this.passwordService.verifyPassword(
      platformUser.passwordHash,
      password,
    );

    if (!passwordMatches) {
      throwInvalidCredentials();
    }

    const { token } = await this.platformSessionService.createSession({
      platformUserId: platformUser.id,
      userAgent: request.header("user-agent"),
      ipAddress: request.ip,
    });

    await this.prisma.platformUser.update({
      where: { id: platformUser.id },
      data: { lastLoginAt: new Date() },
    });

    writePlatformSessionCookie(response, token);
    writeCsrfCookie(response, createCsrfToken(token));

    return toSessionResponse(platformUser);
  }

  async getCurrentPlatformUser(
    request: Request,
  ): Promise<PlatformSessionResponse> {
    const token = readPlatformSessionToken(request);

    if (!token) {
      throwUnauthenticated();
    }

    const session =
      await this.platformSessionService.findActiveSessionByToken(token);

    if (!session) {
      throwUnauthenticated();
    }

    const platformUser = await this.prisma.platformUser.findUnique({
      where: { id: session.platformUserId },
    });

    if (!platformUser || platformUser.status !== "active") {
      throwUnauthenticated();
    }

    return toSessionResponse(platformUser);
  }
}

function toSessionResponse(platformUser: {
  id: string;
  email: string;
  name: string;
  status: string;
}): PlatformSessionResponse {
  return {
    platformUser: {
      id: platformUser.id,
      email: platformUser.email,
      name: platformUser.name,
      status: platformUser.status,
    },
    roleCodes: [PLATFORM_OWNER_ROLE_CODE],
    permissions: [...ROLE_PERMISSION_MATRIX.platform_owner],
  };
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function throwInvalidCredentials(): never {
  throw new UnauthorizedException({
    code: "INVALID_CREDENTIALS",
    message: "Email or password is incorrect.",
  });
}

function throwUnauthenticated(): never {
  throw new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Authentication is required.",
  });
}
