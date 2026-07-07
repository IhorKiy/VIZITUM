import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";

import {
  applyCsrfProtection,
  createCsrfToken,
} from "../src/modules/auth/csrf";

describe("csrf platform session selection", () => {
  it("validates platform mutations with the platform session when both sessions exist", () => {
    const csrfToken = createCsrfToken("platform-token");
    const request = createRequest({
      csrfToken,
      originalUrl: "/api/platform/tenants",
      platformSessionToken: "platform-token",
      sessionToken: "tenant-token",
    });
    let nextCalled = false;

    applyCsrfProtection(request, {} as Response, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it("still rejects platform mutations signed for the tenant session", () => {
    const csrfToken = createCsrfToken("tenant-token");
    const request = createRequest({
      csrfToken,
      originalUrl: "/api/platform/tenants",
      platformSessionToken: "platform-token",
      sessionToken: "tenant-token",
    });

    assert.throws(
      () => applyCsrfProtection(request, {} as Response, () => undefined),
      ForbiddenException,
    );
  });
});

function createRequest(input: {
  csrfToken: string;
  originalUrl: string;
  platformSessionToken: string;
  sessionToken: string;
}): Request {
  const cookie = [
    `vizitum_session=${input.sessionToken}`,
    `vizitum_platform_session=${input.platformSessionToken}`,
    `vizitum_csrf=${input.csrfToken}`,
  ].join("; ");

  return {
    header: (name: string) => {
      if (name.toLowerCase() === "cookie") {
        return cookie;
      }

      if (name.toLowerCase() === "x-csrf-token") {
        return input.csrfToken;
      }

      return undefined;
    },
    method: "POST",
    originalUrl: input.originalUrl,
    url: input.originalUrl,
  } as Request;
}
